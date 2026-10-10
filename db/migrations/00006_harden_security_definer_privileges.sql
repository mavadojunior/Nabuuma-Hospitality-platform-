BEGIN;

-- ============================================================================
-- 00006: Harden security-definer authorization function privileges
--
-- Goal:
--   - Remove public execution on the membership/assessor helper functions.
--   - Restrict function resolution to the nabuuma schema and pg_catalog.
--   - Preserve the stricter trainer/learner authorization model introduced in
--     migration 00002 and guard against stale insecure overloads.
-- ============================================================================

DROP FUNCTION IF EXISTS nabuuma.is_authorized_assessor(UUID, UUID);

REVOKE ALL
ON FUNCTION nabuuma.is_active_member(UUID, UUID)
FROM PUBLIC;

REVOKE ALL
ON FUNCTION nabuuma.is_authorized_assessor(UUID, UUID, UUID)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION nabuuma.is_active_member(UUID, UUID)
TO nabuuma_app;

GRANT EXECUTE
ON FUNCTION nabuuma.is_authorized_assessor(UUID, UUID, UUID)
TO nabuuma_app;

CREATE OR REPLACE FUNCTION nabuuma.is_active_member(p_org UUID, p_user UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = nabuuma, pg_catalog
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM nabuuma.organisation_memberships AS m
        WHERE m.organisation_id = p_org
          AND m.user_id = p_user
          AND m.is_active
    );
$$;

CREATE OR REPLACE FUNCTION nabuuma.is_authorized_assessor(
    p_org UUID,
    p_trainer UUID,
    p_learner UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = nabuuma, pg_catalog
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM nabuuma.organisation_memberships AS trainer_membership
        INNER JOIN nabuuma.trainer_learner_authorizations AS tla
            ON tla.organisation_id = trainer_membership.organisation_id
           AND tla.trainer_id = trainer_membership.user_id
           AND tla.learner_id = p_learner
           AND tla.is_active = true
        INNER JOIN nabuuma.organisation_memberships AS learner_membership
            ON learner_membership.organisation_id = p_org
           AND learner_membership.user_id = p_learner
           AND learner_membership.is_active = true
        WHERE trainer_membership.organisation_id = p_org
          AND trainer_membership.user_id = p_trainer
          AND trainer_membership.is_active = true
          AND trainer_membership.role = 'ASSESSOR'
    );
$$;

COMMIT;
