-- Nabuuma Hospitality Platform
-- Migration: 00001_init_competency_telemetry.sql
-- PostgreSQL 16+
-- Persistence boundary for the competency + telemetry vertical slice.
--
-- Design principles:
--   * PostgreSQL is the final integrity boundary, not merely a storage adapter.
--   * Tenant ownership is explicit on every operational aggregate.
--   * Historical telemetry/evidence/assessment records are append-only.
--   * VERIFIED_COMPETENCY requires a distinct, verified assessment and authorized assessor.
--   * Numeric telemetry is stored in typed columns for indexable queries; JSONB carries
--     domain-specific context without turning measurements into loose text.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS nabuuma;
SET search_path = nabuuma, public;

-- ============================================================================
-- ENUMS
-- ============================================================================

CREATE TYPE node_type AS ENUM ('DOMAIN', 'SKILL', 'CONCEPT');

CREATE TYPE competency_state AS ENUM (
    'EXPOSURE',
    'PRACTICE',
    'DEMONSTRATION',
    'VERIFIED_COMPETENCY'
);

CREATE TYPE actor_role AS ENUM (
    'LEARNER',
    'PROFESSIONAL',
    'ASSESSOR',
    'MANAGER',
    'CONTENT_EDITOR',
    'ORGANISATION_OWNER',
    'PLATFORM_ADMIN'
);

CREATE TYPE telemetry_value_type AS ENUM (
    'DECIMAL',
    'INTEGER',
    'DURATION_MS',
    'RATIO',
    'PERCENTAGE',
    'CATEGORICAL',
    'BOOLEAN',
    'SCORE',
    'RANGE'
);

CREATE TYPE telemetry_quality_status AS ENUM (
    'UNVERIFIED',
    'VALID',
    'QUESTIONABLE',
    'INVALID',
    'EXCLUDED'
);

CREATE TYPE practice_session_status AS ENUM (
    'PLANNED',
    'IN_PROGRESS',
    'SUBMITTED',
    'UNDER_REVIEW',
    'COMPLETED',
    'CANCELLED'
);

CREATE TYPE evidence_status AS ENUM (
    'DRAFT',
    'SUBMITTED',
    'UNDER_REVIEW',
    'ACCEPTED',
    'REJECTED',
    'SUPERSEDED'
);

CREATE TYPE assessment_result AS ENUM (
    'INCOMPLETE',
    'REQUIRES_REASSESSMENT',
    'DEMONSTRATED',
    'VERIFIED'
);

CREATE TYPE knowledge_scope AS ENUM ('PLATFORM', 'ORGANISATION');

-- ============================================================================
-- IDENTITY + MULTI-TENANCY
-- ============================================================================

CREATE TABLE organisations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id UUID REFERENCES organisations(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    level TEXT NOT NULL CHECK (level IN ('ENTERPRISE','REGION','VENUE','TEAM')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (parent_id, code)
);

CREATE INDEX idx_organisations_parent ON organisations(parent_id);
CREATE INDEX idx_organisations_level ON organisations(level);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name TEXT NOT NULL,
    email TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (email)
);

CREATE TABLE organisation_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role actor_role NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organisation_id, user_id)
);

CREATE INDEX idx_memberships_user_org
    ON organisation_memberships(user_id, organisation_id)
    WHERE is_active;

-- Application transaction context. The application must SET LOCAL these values
-- before accessing tenant-scoped runtime data.
CREATE OR REPLACE FUNCTION current_app_user_id()
RETURNS UUID
LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.user_id', true), '')::UUID
$$;

CREATE OR REPLACE FUNCTION current_app_organisation_id()
RETURNS UUID
LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.organisation_id', true), '')::UUID
$$;

CREATE OR REPLACE FUNCTION is_active_member(p_org UUID, p_user UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = nabuuma, public AS $$
    SELECT EXISTS (
        SELECT 1
        FROM organisation_memberships m
        WHERE m.organisation_id = p_org
          AND m.user_id = p_user
          AND m.is_active
    )
$$;

CREATE OR REPLACE FUNCTION is_authorized_assessor(p_org UUID, p_user UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = nabuuma, public AS $$
    SELECT EXISTS (
        SELECT 1
        FROM organisation_memberships m
        WHERE m.organisation_id = p_org
          AND m.user_id = p_user
          AND m.is_active
          AND m.role IN ('ASSESSOR','MANAGER','ORGANISATION_OWNER','PLATFORM_ADMIN')
    )
$$;

-- ============================================================================
-- KNOWLEDGE GRAPH
-- ============================================================================

CREATE TABLE knowledge_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID REFERENCES organisations(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES knowledge_nodes(id) ON DELETE RESTRICT,
    node_type node_type NOT NULL,
    stable_key TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    name TEXT NOT NULL,
    description TEXT,
    scope knowledge_scope NOT NULL DEFAULT 'PLATFORM',
    is_authoritative BOOLEAN NOT NULL DEFAULT false,
    published_at TIMESTAMPTZ,
    retired_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (stable_key, version),
    CHECK (
        (scope = 'PLATFORM' AND organisation_id IS NULL)
        OR
        (scope = 'ORGANISATION' AND organisation_id IS NOT NULL)
    )
);

CREATE INDEX idx_knowledge_nodes_parent ON knowledge_nodes(parent_id);
CREATE INDEX idx_knowledge_nodes_type ON knowledge_nodes(node_type);
CREATE INDEX idx_knowledge_nodes_org ON knowledge_nodes(organisation_id);

CREATE TABLE knowledge_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_node_id UUID NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
    target_node_id UUID NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
    relationship_type TEXT NOT NULL CHECK (
        relationship_type IN (
            'PREREQUISITE_OF','DEPENDS_ON','REQUIRES','SUPPORTS',
            'MEASURED_BY','PRACTICED_THROUGH','ASSESSED_BY',
            'RELATED_TO','CONTRASTS_WITH','SUPERSEDES'
        )
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_node_id, target_node_id, relationship_type),
    CHECK (source_node_id <> target_node_id)
);

CREATE INDEX idx_knowledge_relationships_source
    ON knowledge_relationships(source_node_id);
CREATE INDEX idx_knowledge_relationships_target
    ON knowledge_relationships(target_node_id);

-- ============================================================================
-- COMPETENCY LIFECYCLE
-- ============================================================================

CREATE TABLE competency_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID REFERENCES organisations(id) ON DELETE CASCADE,
    stable_key TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (stable_key, version)
);

CREATE INDEX idx_competency_definitions_org
    ON competency_definitions(organisation_id);

CREATE TABLE competency_required_nodes (
    competency_id UUID NOT NULL REFERENCES competency_definitions(id) ON DELETE CASCADE,
    knowledge_node_id UUID NOT NULL REFERENCES knowledge_nodes(id) ON DELETE RESTRICT,
    PRIMARY KEY (competency_id, knowledge_node_id)
);

CREATE TABLE learner_competencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    learner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    competency_definition_id UUID NOT NULL REFERENCES competency_definitions(id) ON DELETE RESTRICT,
    state competency_state NOT NULL DEFAULT 'EXPOSURE',
    assessment_id UUID,
    verified_by_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organisation_id, learner_id, competency_definition_id)
);

CREATE INDEX idx_learner_competencies_learner
    ON learner_competencies(learner_id);
CREATE INDEX idx_learner_competencies_state
    ON learner_competencies(organisation_id, state);
CREATE INDEX idx_learner_competencies_competency
    ON learner_competencies(competency_definition_id);

-- ============================================================================
-- PRACTICE LAB
-- ============================================================================

CREATE TABLE practice_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    learner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    competency_id UUID NOT NULL REFERENCES learner_competencies(id) ON DELETE RESTRICT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    status practice_session_status NOT NULL DEFAULT 'PLANNED',
    brief JSONB NOT NULL DEFAULT '{}'::jsonb,
    context JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (completed_at IS NULL OR started_at IS NOT NULL),
    CHECK (completed_at IS NULL OR completed_at >= started_at)
);

CREATE INDEX idx_practice_sessions_learner_status
    ON practice_sessions(learner_id, status);
CREATE INDEX idx_practice_sessions_competency
    ON practice_sessions(competency_id);
CREATE INDEX idx_practice_sessions_context_gin
    ON practice_sessions USING GIN(context);

-- ============================================================================
-- TELEMETRY + INSTRUMENTATION
-- ============================================================================

CREATE TABLE telemetry_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stable_key TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    name TEXT NOT NULL,
    value_type telemetry_value_type NOT NULL,
    canonical_unit TEXT,
    method TEXT,
    precision_scale SMALLINT CHECK (precision_scale IS NULL OR precision_scale >= 0),
    min_value NUMERIC,
    max_value NUMERIC,
    reference_standard TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (stable_key, version),
    CHECK (min_value IS NULL OR max_value IS NULL OR min_value <= max_value)
);

CREATE TABLE instruments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID REFERENCES organisations(id) ON DELETE SET NULL,
    instrument_type TEXT NOT NULL,
    manufacturer TEXT,
    model TEXT,
    serial_number TEXT,
    resolution NUMERIC,
    calibration_status TEXT,
    calibrated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_instruments_org ON instruments(organisation_id);

CREATE TABLE telemetry_observations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    practice_session_id UUID NOT NULL REFERENCES practice_sessions(id) ON DELETE RESTRICT,
    telemetry_definition_id UUID NOT NULL REFERENCES telemetry_definitions(id) ON DELETE RESTRICT,
    observed_by_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    instrument_id UUID REFERENCES instruments(id) ON DELETE RESTRICT,
    observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Exactly one typed value is populated. Numeric values remain directly
    -- indexable for range queries, statistics, tolerances and analytics.
    value_numeric NUMERIC,
    value_integer BIGINT,
    value_duration_ms BIGINT,
    value_ratio NUMERIC,
    value_percentage NUMERIC,
    value_category TEXT,
    value_boolean BOOLEAN,
    value_score NUMERIC,
    value_range JSONB,

    unit TEXT,
    method TEXT,
    quality_status telemetry_quality_status NOT NULL DEFAULT 'UNVERIFIED',

    -- Flexible domain context: coffee dose/yield, drink style, station,
    -- recipe revision, environmental conditions, etc.
    context JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK (num_nonnulls(
        value_numeric, value_integer, value_duration_ms, value_ratio,
        value_percentage, value_category, value_boolean, value_score,
        value_range
    ) = 1),

    CHECK (value_duration_ms IS NULL OR value_duration_ms >= 0),
    CHECK (value_percentage IS NULL OR value_percentage BETWEEN 0 AND 100),
    CHECK (value_ratio IS NULL OR value_ratio >= 0),
    CHECK (value_score IS NULL OR value_score >= 0)
);

CREATE INDEX idx_telemetry_numeric
    ON telemetry_observations(telemetry_definition_id, value_numeric)
    WHERE value_numeric IS NOT NULL;

CREATE INDEX idx_telemetry_integer
    ON telemetry_observations(telemetry_definition_id, value_integer)
    WHERE value_integer IS NOT NULL;

CREATE INDEX idx_telemetry_duration
    ON telemetry_observations(telemetry_definition_id, value_duration_ms)
    WHERE value_duration_ms IS NOT NULL;

CREATE INDEX idx_telemetry_session_time
    ON telemetry_observations(practice_session_id, observed_at);

CREATE INDEX idx_telemetry_org_time
    ON telemetry_observations(organisation_id, observed_at);

CREATE INDEX idx_telemetry_context_gin
    ON telemetry_observations USING GIN(context);

-- ============================================================================
-- EVIDENCE / PORTFOLIO
-- ============================================================================

CREATE TABLE evidence_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    learner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    practice_session_id UUID NOT NULL REFERENCES practice_sessions(id) ON DELETE RESTRICT,
    title TEXT NOT NULL,
    status evidence_status NOT NULL DEFAULT 'DRAFT',
    method_summary TEXT,
    reflection TEXT,
    artifact_uri TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    submitted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_evidence_learner_status
    ON evidence_records(learner_id, status);
CREATE INDEX idx_evidence_session ON evidence_records(practice_session_id);
CREATE INDEX idx_evidence_metadata_gin
    ON evidence_records USING GIN(metadata);

CREATE TABLE evidence_telemetry (
    evidence_id UUID NOT NULL REFERENCES evidence_records(id) ON DELETE CASCADE,
    telemetry_observation_id UUID NOT NULL REFERENCES telemetry_observations(id) ON DELETE RESTRICT,
    PRIMARY KEY (evidence_id, telemetry_observation_id)
);

-- ============================================================================
-- ASSESSMENT VERIFICATION
-- ============================================================================

CREATE TABLE assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    learner_competency_id UUID NOT NULL REFERENCES learner_competencies(id) ON DELETE RESTRICT,
    evidence_id UUID NOT NULL REFERENCES evidence_records(id) ON DELETE RESTRICT,
    assessor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    result assessment_result NOT NULL,
    assessment_version INTEGER NOT NULL DEFAULT 1 CHECK (assessment_version > 0),
    notes TEXT,
    assessed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_assessments_competency
    ON assessments(learner_competency_id, assessed_at DESC);
CREATE INDEX idx_assessments_assessor
    ON assessments(assessor_id, assessed_at DESC);
CREATE INDEX idx_assessments_result
    ON assessments(organisation_id, result);

ALTER TABLE learner_competencies
    ADD CONSTRAINT fk_learner_competencies_assessment
    FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE RESTRICT;

-- ============================================================================
-- TENANT CONSISTENCY
-- ============================================================================

CREATE OR REPLACE FUNCTION enforce_practice_tenant()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE competency_org UUID;
BEGIN
    SELECT organisation_id INTO competency_org
    FROM learner_competencies
    WHERE id = NEW.competency_id;

    IF competency_org IS DISTINCT FROM NEW.organisation_id THEN
        RAISE EXCEPTION 'Practice session tenant mismatch';
    END IF;

    RETURN NEW;
END $$;

CREATE TRIGGER trg_practice_tenant
BEFORE INSERT OR UPDATE ON practice_sessions
FOR EACH ROW EXECUTE FUNCTION enforce_practice_tenant();

CREATE OR REPLACE FUNCTION enforce_telemetry_tenant()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE session_org UUID;
BEGIN
    SELECT organisation_id INTO session_org
    FROM practice_sessions
    WHERE id = NEW.practice_session_id;

    IF session_org IS DISTINCT FROM NEW.organisation_id THEN
        RAISE EXCEPTION 'Telemetry tenant mismatch';
    END IF;

    RETURN NEW;
END $$;

CREATE TRIGGER trg_telemetry_tenant
BEFORE INSERT OR UPDATE ON telemetry_observations
FOR EACH ROW EXECUTE FUNCTION enforce_telemetry_tenant();

-- ============================================================================
-- COMPETENCY STATE INTEGRITY
-- ============================================================================

CREATE OR REPLACE FUNCTION enforce_competency_state()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    verified_assessment assessments%ROWTYPE;
BEGIN
    -- A VERIFIED_COMPETENCY row must always point to a distinct assessment
    -- and the assessor who actually performed that verification.
    IF NEW.state = 'VERIFIED_COMPETENCY' THEN
        IF NEW.assessment_id IS NULL OR NEW.verified_by_id IS NULL THEN
            RAISE EXCEPTION
                'VERIFIED_COMPETENCY requires assessment_id and verified_by_id';
        END IF;

        SELECT * INTO verified_assessment
        FROM assessments a
        WHERE a.id = NEW.assessment_id
          AND a.learner_competency_id = NEW.id
          AND a.organisation_id = NEW.organisation_id
          AND a.result = 'VERIFIED';

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'Verified competency requires an existing VERIFIED assessment bound to this learner competency';
        END IF;

        IF verified_assessment.assessor_id IS DISTINCT FROM NEW.verified_by_id THEN
            RAISE EXCEPTION
                'verified_by_id must match the assessment assessor_id';
        END IF;

        IF NOT is_authorized_assessor(NEW.organisation_id, NEW.verified_by_id) THEN
            RAISE EXCEPTION
                'verified_by_id is not an authorized assessor for this organisation';
        END IF;

        -- The actor establishing verified competency must be the assessor.
        IF current_app_user_id() IS DISTINCT FROM NEW.verified_by_id THEN
            RAISE EXCEPTION
                'A learner or unrelated actor cannot award VERIFIED_COMPETENCY';
        END IF;

        NEW.verified_at := COALESCE(NEW.verified_at, now());
    END IF;

    -- Explicitly permit only the competency progression defined by the domain.
    IF TG_OP = 'UPDATE' AND NEW.state IS DISTINCT FROM OLD.state THEN
        IF NOT (
            (OLD.state = 'EXPOSURE' AND NEW.state = 'PRACTICE') OR
            (OLD.state = 'PRACTICE' AND NEW.state = 'DEMONSTRATION') OR
            (OLD.state = 'DEMONSTRATION' AND NEW.state = 'VERIFIED_COMPETENCY')
        ) THEN
            RAISE EXCEPTION 'Invalid competency transition: % -> %',
                OLD.state, NEW.state;
        END IF;

        IF OLD.state = 'VERIFIED_COMPETENCY' THEN
            RAISE EXCEPTION 'VERIFIED_COMPETENCY is terminal';
        END IF;
    END IF;

    RETURN NEW;
END $$;

CREATE TRIGGER trg_enforce_competency_state
BEFORE INSERT OR UPDATE ON learner_competencies
FOR EACH ROW EXECUTE FUNCTION enforce_competency_state();

-- ============================================================================
-- IMMUTABILITY OF HISTORICAL RECORDS
-- ============================================================================

CREATE OR REPLACE FUNCTION prevent_telemetry_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'Telemetry observations are immutable; create a new observation';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Telemetry observations are append-only historical facts';
    END IF;
    RETURN OLD;
END $$;

CREATE TRIGGER trg_telemetry_immutable
BEFORE UPDATE OR DELETE ON telemetry_observations
FOR EACH ROW EXECUTE FUNCTION prevent_telemetry_mutation();

CREATE OR REPLACE FUNCTION prevent_assessment_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Assessments are immutable; create a new assessment version';
    END IF;
    RETURN OLD;
END $$;

CREATE TRIGGER trg_assessment_immutable
BEFORE UPDATE OR DELETE ON assessments
FOR EACH ROW EXECUTE FUNCTION prevent_assessment_mutation();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE organisation_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE learner_competencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessments ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_memberships_select
ON organisation_memberships FOR SELECT
USING (organisation_id = current_app_organisation_id()
       AND is_active_member(organisation_id, current_app_user_id()));

CREATE POLICY tenant_competencies_select
ON learner_competencies FOR SELECT
USING (organisation_id = current_app_organisation_id()
       AND is_active_member(organisation_id, current_app_user_id()));

CREATE POLICY tenant_practice_select
ON practice_sessions FOR SELECT
USING (organisation_id = current_app_organisation_id()
       AND is_active_member(organisation_id, current_app_user_id()));

CREATE POLICY tenant_telemetry_select
ON telemetry_observations FOR SELECT
USING (organisation_id = current_app_organisation_id()
       AND is_active_member(organisation_id, current_app_user_id()));

CREATE POLICY tenant_evidence_select
ON evidence_records FOR SELECT
USING (organisation_id = current_app_organisation_id()
       AND is_active_member(organisation_id, current_app_user_id()));

CREATE POLICY tenant_assessment_select
ON assessments FOR SELECT
USING (organisation_id = current_app_organisation_id()
       AND is_active_member(organisation_id, current_app_user_id()));

COMMIT;
