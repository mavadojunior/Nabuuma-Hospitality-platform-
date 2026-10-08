BEGIN;

-- ============================================================================
-- 00004: Fix trigger-function schema qualification
--
-- Corrects trigger functions originally created in 00001 without explicit
-- schema qualification. This prevents failures when the caller's search_path
-- does not include the nabuuma schema.
--
-- Business logic is intentionally unchanged.
-- ============================================================================

CREATE OR REPLACE FUNCTION nabuuma.enforce_practice_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    competency_org UUID;
BEGIN
    SELECT organisation_id INTO competency_org
    FROM nabuuma.learner_competencies
    WHERE id = NEW.competency_id;

    IF competency_org IS DISTINCT FROM NEW.organisation_id THEN
        RAISE EXCEPTION 'Practice session tenant mismatch';
    END IF;

    RETURN NEW;
END
$$;


CREATE OR REPLACE FUNCTION nabuuma.enforce_telemetry_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    session_org UUID;
BEGIN
    SELECT organisation_id INTO session_org
    FROM nabuuma.practice_sessions
    WHERE id = NEW.practice_session_id;

    IF session_org IS DISTINCT FROM NEW.organisation_id THEN
        RAISE EXCEPTION 'Telemetry tenant mismatch';
    END IF;

    RETURN NEW;
END
$$;


CREATE OR REPLACE FUNCTION nabuuma.enforce_competency_state()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    verified_assessment nabuuma.assessments%ROWTYPE;
BEGIN
    -- A VERIFIED_COMPETENCY row must always point to a distinct assessment
    -- and the assessor who actually performed that verification.
    IF NEW.state = 'VERIFIED_COMPETENCY' THEN
        IF NEW.assessment_id IS NULL OR NEW.verified_by_id IS NULL THEN
            RAISE EXCEPTION
                'VERIFIED_COMPETENCY requires assessment_id and verified_by_id';
        END IF;

        SELECT * INTO verified_assessment
        FROM nabuuma.assessments a
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

        IF NOT nabuuma.is_authorized_assessor(
            NEW.organisation_id,
            NEW.verified_by_id
        ) THEN
            RAISE EXCEPTION
                'verified_by_id is not an authorized assessor for this organisation';
        END IF;

        -- The actor establishing verified competency must be the assessor.
        IF nabuuma.current_app_user_id() IS DISTINCT FROM NEW.verified_by_id THEN
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
END
$$;

COMMIT;
