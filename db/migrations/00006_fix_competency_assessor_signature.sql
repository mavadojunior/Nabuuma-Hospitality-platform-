BEGIN;

-- Correct the assessor authorization call in the competency-state trigger.
-- Preserve assessment binding, assessor identity, and state-transition checks.

CREATE OR REPLACE FUNCTION nabuuma.enforce_competency_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, nabuuma
AS $function$
DECLARE
    verified_assessment nabuuma.assessments%ROWTYPE;
BEGIN
    IF NEW.state = 'VERIFIED_COMPETENCY' THEN
        IF NEW.assessment_id IS NULL OR NEW.verified_by_id IS NULL THEN
            RAISE EXCEPTION
                'VERIFIED_COMPETENCY requires assessment_id and verified_by_id';
        END IF;

        SELECT *
        INTO verified_assessment
        FROM nabuuma.assessments AS a
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
            NEW.verified_by_id,
            NEW.learner_id
        ) THEN
            RAISE EXCEPTION
                'verified_by_id is not an authorized assessor for this learner';
        END IF;

        IF nabuuma.current_app_user_id() IS DISTINCT FROM NEW.verified_by_id THEN
            RAISE EXCEPTION
                'A learner or unrelated actor cannot award VERIFIED_COMPETENCY';
        END IF;

        NEW.verified_at := COALESCE(NEW.verified_at, pg_catalog.now());
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.state IS DISTINCT FROM OLD.state THEN
        IF NOT (
            (OLD.state = 'EXPOSURE' AND NEW.state = 'PRACTICE')
            OR (OLD.state = 'PRACTICE' AND NEW.state = 'DEMONSTRATION')
            OR (OLD.state = 'DEMONSTRATION' AND NEW.state = 'VERIFIED_COMPETENCY')
        ) THEN
            RAISE EXCEPTION 'Invalid competency transition: % -> %',
                OLD.state, NEW.state;
        END IF;

        IF OLD.state = 'VERIFIED_COMPETENCY' THEN
            RAISE EXCEPTION 'VERIFIED_COMPETENCY is terminal';
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

COMMIT;
