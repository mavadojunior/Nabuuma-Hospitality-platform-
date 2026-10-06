BEGIN;

SET LOCAL search_path = nabuuma, public;

-- ============================================================================
-- Nabuuma Hospitality Platform
-- Migration: 00002_rls_write_policies_and_invariants.sql
--
-- Purpose:
--   1. Establish the application database role.
--   2. Close RLS write-policy gaps.
--   3. Enforce competency-definition tenant boundaries.
--   4. Enforce trainer -> learner authorization at the database boundary.
--   5. Enforce assessment/evidence learner and tenant linkage.
--   6. Enforce practice-session tenant + learner linkage.
--   7. Preserve PostgreSQL as the final authorization/integrity boundary.
--
-- PostgreSQL 16+
-- ============================================================================


-- ============================================================================
-- 0. APPLICATION ROLE
-- ============================================================================
--
-- nabuuma_app is intentionally a NOLOGIN group role.
--
-- The actual connection/login role used by the application must be granted
-- membership in nabuuma_app outside this migration.
--
-- The role itself is explicitly prevented from bypassing RLS or administering
-- the database.
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_roles
        WHERE rolname = 'nabuuma_app'
    ) THEN
        CREATE ROLE nabuuma_app
            NOLOGIN
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE
            NOBYPASSRLS;
    ELSE
        ALTER ROLE nabuuma_app
            NOLOGIN
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE
            NOBYPASSRLS;
    END IF;
END
$$;


GRANT USAGE ON SCHEMA nabuuma
TO nabuuma_app;


-- ============================================================================
-- 1. APPLICATION TABLE PRIVILEGES
-- ============================================================================
--
-- RLS remains the authorization boundary.
--
-- These grants provide the SQL privileges required to attempt the operation.
-- RLS determines whether the operation is actually permitted.
--
-- There are deliberately no DELETE policies.
--
-- There are deliberately no UPDATE policies for immutable telemetry and
-- assessments.
-- ============================================================================

GRANT
    SELECT,
    INSERT,
    UPDATE,
    DELETE
ON nabuuma.learner_competencies
TO nabuuma_app;

GRANT
    SELECT,
    INSERT,
    UPDATE,
    DELETE
ON nabuuma.practice_sessions
TO nabuuma_app;

GRANT
    SELECT,
    INSERT,
    UPDATE,
    DELETE
ON nabuuma.telemetry_observations
TO nabuuma_app;

GRANT
    SELECT,
    INSERT,
    UPDATE,
    DELETE
ON nabuuma.evidence_records
TO nabuuma_app;

GRANT
    SELECT,
    INSERT,
    UPDATE,
    DELETE
ON nabuuma.assessments
TO nabuuma_app;


-- Read dependencies required by the application authorization policies
-- and database-backed repository operations.

GRANT SELECT
ON nabuuma.organisation_memberships
TO nabuuma_app;

GRANT SELECT
ON nabuuma.competency_definitions
TO nabuuma_app;

GRANT SELECT
ON nabuuma.telemetry_definitions
TO nabuuma_app;

GRANT SELECT
ON nabuuma.instruments
TO nabuuma_app;


-- ============================================================================
-- 2. DATABASE CONTEXT FUNCTIONS
-- ============================================================================
--
-- The application transaction manager establishes these values with:
--
--   set_config('app.user_id', ..., true)
--   set_config('app.organisation_id', ..., true)
--
-- The TRUE argument makes the values transaction-local.
-- ============================================================================

GRANT EXECUTE
ON FUNCTION nabuuma.current_app_user_id()
TO nabuuma_app;

GRANT EXECUTE
ON FUNCTION nabuuma.current_app_organisation_id()
TO nabuuma_app;


-- ============================================================================
-- 3. TRAINER -> LEARNER AUTHORIZATION TABLE
-- ============================================================================
--
-- A trainer is not authorized merely because the trainer belongs to the
-- organisation.
--
-- Verification requires:
--
--   organisation membership
--   role = ASSESSOR
--   active trainer membership
--   active learner membership
--   explicit active trainer -> learner authorization
--
-- The application role receives no direct SELECT/INSERT/UPDATE/DELETE
-- privileges on this table. Authorization is exposed through the
-- SECURITY DEFINER function below.
-- ============================================================================

CREATE TABLE nabuuma.trainer_learner_authorizations (
    organisation_id UUID NOT NULL
        REFERENCES nabuuma.organisations(id)
        ON DELETE CASCADE,

    trainer_id UUID NOT NULL
        REFERENCES nabuuma.users(id)
        ON DELETE CASCADE,

    learner_id UUID NOT NULL
        REFERENCES nabuuma.users(id)
        ON DELETE CASCADE,

    is_active BOOLEAN NOT NULL DEFAULT true,

    authorized_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    authorized_by_id UUID
        REFERENCES nabuuma.users(id)
        ON DELETE RESTRICT,

    PRIMARY KEY (
        organisation_id,
        trainer_id,
        learner_id
    ),

    CHECK (trainer_id <> learner_id)
);


CREATE INDEX idx_trainer_learner_authorizations_active
ON nabuuma.trainer_learner_authorizations (
    organisation_id,
    trainer_id,
    learner_id
)
WHERE is_active;


ALTER TABLE nabuuma.trainer_learner_authorizations
ENABLE ROW LEVEL SECURITY;


-- No application policies are created on this table.
--
-- Therefore the nabuuma_app role cannot directly read or modify authorization
-- relationships. The SECURITY DEFINER authorization function below is the
-- controlled database interface.


-- ============================================================================
-- 4. STRICT TRAINER -> LEARNER AUTHORIZATION FUNCTION
-- ============================================================================
--
-- IMPORTANT:
-- The previous migration defined:
--
--   is_authorized_assessor(UUID, UUID)
--
-- PostgreSQL overloads functions by argument signature, so merely creating a
-- three-argument version would leave the old insecure two-argument function
-- alive.
--
-- Therefore the old function is explicitly dropped.
-- ============================================================================

DROP FUNCTION IF EXISTS
    nabuuma.is_authorized_assessor(UUID, UUID);


CREATE OR REPLACE FUNCTION nabuuma.is_authorized_assessor(
    p_org UUID,
    p_trainer UUID,
    p_learner UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = nabuuma, public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM nabuuma.organisation_memberships trainer_membership
        INNER JOIN nabuuma.trainer_learner_authorizations tla
            ON tla.organisation_id = trainer_membership.organisation_id
           AND tla.trainer_id = trainer_membership.user_id
           AND tla.learner_id = p_learner
           AND tla.is_active = true
        INNER JOIN nabuuma.organisation_memberships learner_membership
            ON learner_membership.organisation_id = p_org
           AND learner_membership.user_id = p_learner
           AND learner_membership.is_active = true
        WHERE trainer_membership.organisation_id = p_org
          AND trainer_membership.user_id = p_trainer
          AND trainer_membership.is_active = true
          AND trainer_membership.role = 'ASSESSOR'
    );
$$;


REVOKE ALL
ON FUNCTION nabuuma.is_authorized_assessor(UUID, UUID, UUID)
FROM PUBLIC;


GRANT EXECUTE
ON FUNCTION nabuuma.is_authorized_assessor(UUID, UUID, UUID)
TO nabuuma_app;


-- ============================================================================
-- 5. REPLACE COMPETENCY STATE ENFORCEMENT
-- ============================================================================
--
-- The previous trigger called the old two-argument authorization function.
--
-- This replacement:
--
--   - uses the strict three-argument trainer/learner authorization;
--   - requires the authenticated actor to be the verifying trainer;
--   - requires a VERIFIED assessment;
--   - binds the assessment to this learner competency;
--   - binds the assessment assessor to verified_by_id;
--   - makes VERIFIED_COMPETENCY terminal;
--   - rejects mutation of an already VERIFIED competency.
-- ============================================================================

CREATE OR REPLACE FUNCTION nabuuma.enforce_competency_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = nabuuma, public
AS $$
DECLARE
    verified_assessment nabuuma.assessments%ROWTYPE;
BEGIN

    -- ------------------------------------------------------------------------
    -- VERIFIED_COMPETENCY is terminal.
    --
    -- Once verified, the competency row cannot be modified. Historical
    -- verification evidence must remain immutable.
    -- ------------------------------------------------------------------------

    IF TG_OP = 'UPDATE'
       AND OLD.state = 'VERIFIED_COMPETENCY'
    THEN
        RAISE EXCEPTION
            'VERIFIED_COMPETENCY is terminal and cannot be modified';
    END IF;


    -- ------------------------------------------------------------------------
    -- Validate requested VERIFIED_COMPETENCY state.
    -- ------------------------------------------------------------------------

    IF NEW.state = 'VERIFIED_COMPETENCY' THEN

        IF NEW.assessment_id IS NULL
           OR NEW.verified_by_id IS NULL
        THEN
            RAISE EXCEPTION
                'VERIFIED_COMPETENCY requires assessment_id and verified_by_id';
        END IF;


        SELECT *
        INTO verified_assessment
        FROM nabuuma.assessments a
        WHERE a.id = NEW.assessment_id
          AND a.learner_competency_id = NEW.id
          AND a.organisation_id = NEW.organisation_id
          AND a.result = 'VERIFIED';


        IF NOT FOUND THEN
            RAISE EXCEPTION
                'Verified competency requires an existing VERIFIED assessment bound to this learner competency';
        END IF;


        IF verified_assessment.assessor_id
           IS DISTINCT FROM NEW.verified_by_id
        THEN
            RAISE EXCEPTION
                'verified_by_id must match the assessment assessor_id';
        END IF;


        IF NOT nabuuma.is_authorized_assessor(
            NEW.organisation_id,
            NEW.verified_by_id,
            NEW.learner_id
        )
        THEN
            RAISE EXCEPTION
                'verified_by_id is not an authorized assessor for this learner';
        END IF;


        IF nabuuma.current_app_user_id()
           IS DISTINCT FROM NEW.verified_by_id
        THEN
            RAISE EXCEPTION
                'A learner or unrelated actor cannot award VERIFIED_COMPETENCY';
        END IF;


        NEW.verified_at :=
            COALESCE(NEW.verified_at, now());

    END IF;


    -- ------------------------------------------------------------------------
    -- Enforce the competency state machine.
    -- ------------------------------------------------------------------------

    IF TG_OP = 'UPDATE'
       AND NEW.state IS DISTINCT FROM OLD.state
    THEN

        IF NOT (
            (OLD.state = 'EXPOSURE'
             AND NEW.state = 'PRACTICE')

            OR

            (OLD.state = 'PRACTICE'
             AND NEW.state = 'DEMONSTRATION')

            OR

            (OLD.state = 'DEMONSTRATION'
             AND NEW.state = 'VERIFIED_COMPETENCY')
        )
        THEN
            RAISE EXCEPTION
                'Invalid competency transition: % -> %',
                OLD.state,
                NEW.state;
        END IF;

    END IF;


    RETURN NEW;
END;
$$;


-- The existing trigger from migration 00001 remains attached to the function.
-- Replacing the function body therefore updates the trigger behaviour without
-- creating a duplicate trigger.

REVOKE ALL
ON FUNCTION nabuuma.enforce_competency_state()
FROM PUBLIC;


-- ============================================================================
-- 6. COMPETENCY DEFINITION TENANT INVARIANT
-- ============================================================================
--
-- competency_definitions supports:
--
--   organisation_id IS NULL
--       = platform/global definition
--
--   organisation_id = tenant
--       = tenant-local definition
--
-- A learner competency may therefore reference only:
--
--   global definition
--   OR
--   definition belonging to the same organisation.
--
-- A cross-tenant custom definition is rejected at the database boundary.
-- ============================================================================

CREATE OR REPLACE FUNCTION nabuuma.enforce_competency_definition_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nabuuma, public
AS $$
DECLARE
    definition_org UUID;
BEGIN

    SELECT cd.organisation_id
    INTO definition_org
    FROM nabuuma.competency_definitions cd
    WHERE cd.id = NEW.competency_definition_id;


    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Competency definition does not exist';
    END IF;


    IF definition_org IS NOT NULL
       AND definition_org IS DISTINCT FROM NEW.organisation_id
    THEN
        RAISE EXCEPTION
            'Competency definition tenant mismatch';
    END IF;


    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS
    trg_competency_definition_tenant
ON nabuuma.learner_competencies;


CREATE TRIGGER trg_competency_definition_tenant
BEFORE INSERT OR UPDATE
ON nabuuma.learner_competencies
FOR EACH ROW
EXECUTE FUNCTION nabuuma.enforce_competency_definition_tenant();


REVOKE ALL
ON FUNCTION nabuuma.enforce_competency_definition_tenant()
FROM PUBLIC;


-- ============================================================================
-- 7. COMPETENCY-DEFINITION RLS
-- ============================================================================
--
-- Global definitions are visible to authenticated application users who have
-- an active membership in the active organisation.
--
-- Tenant-local definitions are visible only inside their own organisation.
--
-- There are intentionally no INSERT/UPDATE/DELETE policies here.
-- Competency-definition authoring remains outside the normal learner runtime
-- application role.
-- ============================================================================

ALTER TABLE nabuuma.competency_definitions
ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS
    tenant_competency_definitions_select
ON nabuuma.competency_definitions;


CREATE POLICY tenant_competency_definitions_select
ON nabuuma.competency_definitions
FOR SELECT
TO nabuuma_app
USING (
    nabuuma.current_app_organisation_id() IS NOT NULL
    AND nabuuma.current_app_user_id() IS NOT NULL
    AND nabuuma.is_active_member(
        nabuuma.current_app_organisation_id(),
        nabuuma.current_app_user_id()
    )
    AND (
        organisation_id IS NULL
        OR organisation_id = nabuuma.current_app_organisation_id()
    )
);


-- ============================================================================
-- 8. RESTRICT EXISTING SELECT POLICIES TO APPLICATION ROLE
-- ============================================================================
--
-- Migration 00001 created tenant SELECT policies without an explicit role,
-- which means they default to PUBLIC.
--
-- Replace them with equivalent policies targeted specifically at the
-- application role.
-- ============================================================================

DROP POLICY IF EXISTS
    tenant_memberships_select
ON nabuuma.organisation_memberships;


CREATE POLICY tenant_memberships_select
ON nabuuma.organisation_memberships
FOR SELECT
TO nabuuma_app
USING (
    organisation_id = nabuuma.current_app_organisation_id()
    AND nabuuma.is_active_member(
        organisation_id,
        nabuuma.current_app_user_id()
    )
);


DROP POLICY IF EXISTS
    tenant_competencies_select
ON nabuuma.learner_competencies;


CREATE POLICY tenant_competencies_select
ON nabuuma.learner_competencies
FOR SELECT
TO nabuuma_app
USING (
    organisation_id = nabuuma.current_app_organisation_id()
    AND nabuuma.is_active_member(
        organisation_id,
        nabuuma.current_app_user_id()
    )
);


DROP POLICY IF EXISTS
    tenant_practice_select
ON nabuuma.practice_sessions;


CREATE POLICY tenant_practice_select
ON nabuuma.practice_sessions
FOR SELECT
TO nabuuma_app
USING (
    organisation_id = nabuuma.current_app_organisation_id()
    AND nabuuma.is_active_member(
        organisation_id,
        nabuuma.current_app_user_id()
    )
);


DROP POLICY IF EXISTS
    tenant_telemetry_select
ON nabuuma.telemetry_observations;


CREATE POLICY tenant_telemetry_select
ON nabuuma.telemetry_observations
FOR SELECT
TO nabuuma_app
USING (
    organisation_id = nabuuma.current_app_organisation_id()
    AND nabuuma.is_active_member(
        organisation_id,
        nabuuma.current_app_user_id()
    )
);


DROP POLICY IF EXISTS
    tenant_evidence_select
ON nabuuma.evidence_records;


CREATE POLICY tenant_evidence_select
ON nabuuma.evidence_records
FOR SELECT
TO nabuuma_app
USING (
    organisation_id = nabuuma.current_app_organisation_id()
    AND nabuuma.is_active_member(
        organisation_id,
        nabuuma.current_app_user_id()
    )
);


DROP POLICY IF EXISTS
    tenant_assessment_select
ON nabuuma.assessments;


CREATE POLICY tenant_assessment_select
ON nabuuma.assessments
FOR SELECT
TO nabuuma_app
USING (
    organisation_id = nabuuma.current_app_organisation_id()
    AND nabuuma.is_active_member(
        organisation_id,
        nabuuma.current_app_user_id()
    )
);


-- ============================================================================
-- 9. LEARNER COMPETENCY WRITE RLS
-- ============================================================================
--
-- INSERT:
--   - active actor membership in current tenant
--   - inserted organisation must equal current tenant
--
-- UPDATE:
--   - active actor membership in current tenant
--   - resulting organisation must remain current tenant
--
-- DELETE:
--   - deliberately no policy
--   - therefore denied by default under RLS
-- ============================================================================

DROP POLICY IF EXISTS
    tenant_competencies_insert
ON nabuuma.learner_competencies;


CREATE POLICY tenant_competencies_insert
ON nabuuma.learner_competencies
FOR INSERT
TO nabuuma_app
WITH CHECK (
    organisation_id = nabuuma.current_app_organisation_id()
    AND nabuuma.is_active_member(
        organisation_id,
        nabuuma.current_app_user_id()
    )
);


DROP POLICY IF EXISTS
    tenant_competencies_update
ON nabuuma.learner_competencies;


CREATE POLICY tenant_competencies_update
ON nabuuma.learner_competencies
FOR UPDATE
TO nabuuma_app
USING (
    organisation_id = nabuuma.current_app_organisation_id()
    AND nabuuma.is_active_member(
        organisation_id,
        nabuuma.current_app_user_id()
    )
)
WITH CHECK (
    organisation_id = nabuuma.current_app_organisation_id()
    AND nabuuma.is_active_member(
        organisation_id,
        nabuuma.current_app_user_id()
    )
);


-- ============================================================================
-- 10. PRACTICE SESSION WRITE RLS
-- ============================================================================

DROP POLICY IF EXISTS
    tenant_practice_insert
ON nabuuma.practice_sessions;


CREATE POLICY tenant_practice_insert
ON nabuuma.practice_sessions
FOR INSERT
TO nabuuma_app
WITH CHECK (
    organisation_id = nabuuma.current_app_organisation_id()
    AND learner_id = nabuuma.current_app_user_id()
    AND nabuuma.is_active_member(
        organisation_id,
        nabuuma.current_app_user_id()
    )
);


DROP POLICY IF EXISTS
    tenant_practice_update
ON nabuuma.practice_sessions;


CREATE POLICY tenant_practice_update
ON nabuuma.practice_sessions
FOR UPDATE
TO nabuuma_app
USING (
    organisation_id = nabuuma.current_app_organisation_id()
    AND nabuuma.is_active_member(
        organisation_id,
        nabuuma.current_app_user_id()
    )
)
WITH CHECK (
    organisation_id = nabuuma.current_app_organisation_id()
    AND nabuuma.is_active_member(
        organisation_id,
        nabuuma.current_app_user_id()
    )
);


-- ============================================================================
-- 11. PRACTICE TENANT + LEARNER INVARIANT
-- ============================================================================
--
-- A practice session must belong to:
--
--   organisation_id
--       = learner competency organisation
--
--   learner_id
--       = learner competency learner
--
-- This closes both tenant and actor/learner identity drift.
-- ============================================================================

CREATE OR REPLACE FUNCTION nabuuma.enforce_practice_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nabuuma, public
AS $$
DECLARE
    competency_org UUID;
    competency_learner UUID;
BEGIN

    SELECT
        lc.organisation_id,
        lc.learner_id
    INTO
        competency_org,
        competency_learner
    FROM nabuuma.learner_competencies lc
    WHERE lc.id = NEW.competency_id;


    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Practice session references a nonexistent learner competency';
    END IF;


    IF competency_org IS DISTINCT FROM NEW.organisation_id THEN
        RAISE EXCEPTION
            'Practice session tenant mismatch';
    END IF;


    IF competency_learner IS DISTINCT FROM NEW.learner_id THEN
        RAISE EXCEPTION
            'Practice session learner mismatch';
    END IF;


    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS
    trg_practice_tenant
ON nabuuma.practice_sessions;


CREATE TRIGGER trg_practice_tenant
BEFORE INSERT OR UPDATE
ON nabuuma.practice_sessions
FOR EACH ROW
EXECUTE FUNCTION nabuuma.enforce_practice_tenant();


REVOKE ALL
ON FUNCTION nabuuma.enforce_practice_tenant()
FROM PUBLIC;


-- ============================================================================
-- 12. TELEMETRY WRITE RLS
-- ============================================================================
--
-- Telemetry is append-only.
--
-- INSERT requires:
--   - current tenant
--   - active membership
--   - observed_by_id = current authenticated actor
--   - referenced practice session in the same tenant
-- ============================================================================

DROP POLICY IF EXISTS
    tenant_telemetry_insert
ON nabuuma.telemetry_observations;


CREATE POLICY tenant_telemetry_insert
ON nabuuma.telemetry_observations
FOR INSERT
TO nabuuma_app
WITH CHECK (
    organisation_id = nabuuma.current_app_organisation_id()
    AND observed_by_id = nabuuma.current_app_user_id()
    AND nabuuma.is_active_member(
        organisation_id,
        nabuuma.current_app_user_id()
    )
    AND EXISTS (
        SELECT 1
        FROM nabuuma.practice_sessions ps
        WHERE ps.id = practice_session_id
          AND ps.organisation_id = organisation_id
    )
);


-- No UPDATE policy.
-- No DELETE policy.
--
-- Existing trg_telemetry_immutable additionally rejects UPDATE/DELETE.


-- ============================================================================
-- 13. EVIDENCE WRITE RLS
-- ============================================================================
--
-- Evidence must be created inside the active tenant.
--
-- The learner must be an active member of that tenant.
--
-- The referenced practice session must belong to the same tenant and learner.
-- ============================================================================

DROP POLICY IF EXISTS
    tenant_evidence_insert
ON nabuuma.evidence_records;


CREATE POLICY tenant_evidence_insert
ON nabuuma.evidence_records
FOR INSERT
TO nabuuma_app
WITH CHECK (
    organisation_id = nabuuma.current_app_organisation_id()
    AND nabuuma.is_active_member(
        organisation_id,
        nabuuma.current_app_user_id()
    )
    AND EXISTS (
        SELECT 1
        FROM nabuuma.organisation_memberships learner_membership
        WHERE learner_membership.organisation_id = organisation_id
          AND learner_membership.user_id = learner_id
          AND learner_membership.is_active = true
    )
    AND EXISTS (
        SELECT 1
        FROM nabuuma.practice_sessions ps
        WHERE ps.id = practice_session_id
          AND ps.organisation_id = organisation_id
          AND ps.learner_id = learner_id
    )
);


-- No UPDATE policy.
-- No DELETE policy.


-- ============================================================================
-- 14. ASSESSMENT WRITE RLS
-- ============================================================================
--
-- An assessment may be inserted only when:
--
--   1. organisation_id is the active tenant;
--   2. assessor_id is the authenticated actor;
--   3. authenticated actor is an active ASSESSOR;
--   4. explicit trainer -> learner authorization exists;
--   5. learner competency belongs to this tenant;
--   6. evidence belongs to this tenant;
--   7. evidence learner matches learner competency learner;
--   8. evidence practice session belongs to the same learner/tenant.
--
-- This is deliberately duplicated at the RLS boundary even though the
-- repository also validates these relationships. PostgreSQL is authoritative.
-- ============================================================================

DROP POLICY IF EXISTS
    tenant_assessment_insert
ON nabuuma.assessments;


CREATE POLICY tenant_assessment_insert
ON nabuuma.assessments
FOR INSERT
TO nabuuma_app
WITH CHECK (
    organisation_id = nabuuma.current_app_organisation_id()

    AND assessor_id = nabuuma.current_app_user_id()

    AND nabuuma.is_active_member(
        organisation_id,
        nabuuma.current_app_user_id()
    )

    AND EXISTS (
        SELECT 1
        FROM nabuuma.learner_competencies lc
        WHERE lc.id = learner_competency_id
          AND lc.organisation_id = nabuuma.current_app_organisation_id()
            AND nabuuma.is_authorized_assessor(
                nabuuma.current_app_organisation_id(),
                nabuuma.current_app_user_id(),
                lc.learner_id
            )
    )

    AND EXISTS (
        SELECT 1
        FROM nabuuma.evidence_records er
        INNER JOIN nabuuma.learner_competencies lc
            ON lc.id = learner_competency_id
        WHERE er.id = evidence_id
          AND er.organisation_id = nabuuma.current_app_organisation_id()
          AND er.learner_id = lc.learner_id
    )
);


-- No UPDATE policy.
-- No DELETE policy.
--
-- Existing trg_assessment_immutable additionally rejects UPDATE/DELETE.


-- ============================================================================
-- 15. ATOMIC ASSESSMENT -> EVIDENCE LINKAGE
-- ============================================================================
--
-- RLS protects normal application writes.
--
-- This trigger provides a second, database-level invariant for privileged
-- execution paths as well.
--
-- Required:
--
--   assessment.organisation_id
--       = learner_competency.organisation_id
--
--   assessment.organisation_id
--       = evidence.organisation_id
--
--   evidence.learner_id
--       = learner_competency.learner_id
--
--   evidence.practice_session
--       belongs to the same tenant + learner
-- ============================================================================

CREATE OR REPLACE FUNCTION nabuuma.enforce_assessment_evidence_linkage()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nabuuma, public
AS $$
DECLARE
    competency_org UUID;
    competency_learner UUID;

    evidence_org UUID;
    evidence_learner UUID;
    evidence_session UUID;
BEGIN

    SELECT
        lc.organisation_id,
        lc.learner_id
    INTO
        competency_org,
        competency_learner
    FROM nabuuma.learner_competencies lc
    WHERE lc.id = NEW.learner_competency_id;


    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Assessment references a nonexistent learner competency';
    END IF;


    SELECT
        er.organisation_id,
        er.learner_id,
        er.practice_session_id
    INTO
        evidence_org,
        evidence_learner,
        evidence_session
    FROM nabuuma.evidence_records er
    WHERE er.id = NEW.evidence_id;


    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Assessment references a nonexistent evidence record';
    END IF;


    IF competency_org IS DISTINCT FROM NEW.organisation_id THEN
        RAISE EXCEPTION
            'Assessment learner competency tenant mismatch';
    END IF;


    IF evidence_org IS DISTINCT FROM NEW.organisation_id THEN
        RAISE EXCEPTION
            'Assessment evidence tenant mismatch';
    END IF;


    IF evidence_learner IS DISTINCT FROM competency_learner THEN
        RAISE EXCEPTION
            'Assessment evidence learner does not match learner competency';
    END IF;


    IF NOT EXISTS (
        SELECT 1
        FROM nabuuma.practice_sessions ps
        WHERE ps.id = evidence_session
          AND ps.organisation_id = NEW.organisation_id
          AND ps.learner_id = competency_learner
    )
    THEN
        RAISE EXCEPTION
            'Assessment evidence practice session does not match learner and tenant';
    END IF;


    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS
    trg_assessment_evidence_linkage
ON nabuuma.assessments;


CREATE TRIGGER trg_assessment_evidence_linkage
BEFORE INSERT OR UPDATE
ON nabuuma.assessments
FOR EACH ROW
EXECUTE FUNCTION nabuuma.enforce_assessment_evidence_linkage();


REVOKE ALL
ON FUNCTION nabuuma.enforce_assessment_evidence_linkage()
FROM PUBLIC;


-- ============================================================================
-- 16. EXISTING SECURITY-DEFINER MEMBERSHIP FUNCTION
-- ============================================================================
--
-- The RLS policies depend on this function.
-- Ensure the application role can invoke it.
-- ============================================================================

GRANT EXECUTE
ON FUNCTION nabuuma.is_active_member(UUID, UUID)
TO nabuuma_app;


-- ============================================================================
-- 17. RLS ASSERTIONS
-- ============================================================================
--
-- Explicitly enable RLS on all application boundary tables.
--
-- Migration 00001 already enabled these tables, but repeating ALTER TABLE
-- here makes the migration's security intent explicit and protects against
-- schema drift during controlled deployment.
-- ============================================================================

ALTER TABLE nabuuma.organisation_memberships
ENABLE ROW LEVEL SECURITY;

ALTER TABLE nabuuma.learner_competencies
ENABLE ROW LEVEL SECURITY;

ALTER TABLE nabuuma.practice_sessions
ENABLE ROW LEVEL SECURITY;

ALTER TABLE nabuuma.telemetry_observations
ENABLE ROW LEVEL SECURITY;

ALTER TABLE nabuuma.evidence_records
ENABLE ROW LEVEL SECURITY;

ALTER TABLE nabuuma.assessments
ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- 18. SECURITY COMMENTS
-- ============================================================================

COMMENT ON TABLE nabuuma.trainer_learner_authorizations IS
'Explicit database authorization relationship between an active ASSESSOR and learner within an organisation. Application role accesses authorization only through SECURITY DEFINER authorization functions.';

COMMENT ON FUNCTION nabuuma.is_authorized_assessor(UUID, UUID, UUID) IS
'Returns true only for an active ASSESSOR with an active explicit trainer-to-learner authorization relationship in the requested organisation.';

COMMENT ON FUNCTION nabuuma.enforce_competency_definition_tenant() IS
'Prevents a learner competency from referencing a tenant-local competency definition belonging to another organisation. NULL organisation_id represents a global definition.';

COMMENT ON FUNCTION nabuuma.enforce_practice_tenant() IS
'Ensures a practice session organisation and learner both match the referenced learner competency.';

COMMENT ON FUNCTION nabuuma.enforce_assessment_evidence_linkage() IS
'Ensures assessment, learner competency, evidence, and evidence practice session share the correct tenant and learner identity.';


COMMIT;
