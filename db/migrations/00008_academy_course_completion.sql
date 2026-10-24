BEGIN;

CREATE OR REPLACE FUNCTION nabuuma.complete_academy_course(
    p_course_id UUID,
    p_enrolment_id UUID
)
RETURNS TABLE (
    id UUID,
    organisation_id UUID,
    learner_id UUID,
    course_id UUID,
    enrolment_id UUID,
    certificate_number TEXT,
    issued_at TIMESTAMPTZ,
    issued_by_id UUID,
    metadata JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
    v_organisation_id UUID;
    v_learner_id UUID;
    v_enrolment nabuuma.academy_enrolments%ROWTYPE;
    v_published_lesson_count BIGINT;
    v_completed_lesson_count BIGINT;
BEGIN
    v_organisation_id :=
        nabuuma.current_app_organisation_id();

    v_learner_id :=
        nabuuma.current_app_user_id();

    IF v_organisation_id IS NULL OR v_learner_id IS NULL THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '42501',
                MESSAGE =
                    'Authenticated Academy context is required';
    END IF;

    IF NOT nabuuma.is_active_member(
        v_organisation_id,
        v_learner_id
    ) THEN
        RAISE EXCEPTION
            USING
                ERRCODE = '42501',
                MESSAGE =
                    'Active Academy membership is required';
    END IF;

    SELECT enrolment.*
    INTO v_enrolment
    FROM nabuuma.academy_enrolments AS enrolment
    INNER JOIN nabuuma.academy_courses AS course
        ON course.organisation_id =
            enrolment.organisation_id
       AND course.id = enrolment.course_id
    WHERE enrolment.id = p_enrolment_id
      AND enrolment.course_id = p_course_id
      AND enrolment.organisation_id =
          v_organisation_id
      AND enrolment.learner_id = v_learner_id
      AND course.is_published = true
    FOR UPDATE OF enrolment;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            USING
                ERRCODE = 'P0001',
                MESSAGE =
                    'Academy enrolment is unavailable for completion';
    END IF;

    IF v_enrolment.status = 'COMPLETED' THEN
        RETURN QUERY
        SELECT
            certificate.id,
            certificate.organisation_id,
            certificate.learner_id,
            certificate.course_id,
            certificate.enrolment_id,
            certificate.certificate_number,
            certificate.issued_at,
            certificate.issued_by_id,
            certificate.metadata
        FROM nabuuma.academy_certificates
            AS certificate
        WHERE certificate.organisation_id =
                v_organisation_id
          AND certificate.learner_id = v_learner_id
          AND certificate.course_id = p_course_id
          AND certificate.enrolment_id =
                p_enrolment_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                USING
                    ERRCODE = 'P0001',
                    MESSAGE =
                        'Completed Academy enrolment has no certificate';
        END IF;

        RETURN;
    END IF;

    IF v_enrolment.status <> 'ACTIVE' THEN
        RAISE EXCEPTION
            USING
                ERRCODE = 'P0001',
                MESSAGE =
                    'Academy enrolment is not active';
    END IF;

    SELECT count(*)
    INTO v_published_lesson_count
    FROM nabuuma.academy_lessons AS lesson
    WHERE lesson.organisation_id =
            v_organisation_id
      AND lesson.course_id = p_course_id
      AND lesson.is_published = true;

    IF v_published_lesson_count = 0 THEN
        RAISE EXCEPTION
            USING
                ERRCODE = 'P0001',
                MESSAGE =
                    'Academy course has no published lessons';
    END IF;

    SELECT count(*)
    INTO v_completed_lesson_count
    FROM nabuuma.academy_lessons AS lesson
    INNER JOIN nabuuma.academy_lesson_progress
        AS progress
        ON progress.organisation_id =
            lesson.organisation_id
       AND progress.course_id = lesson.course_id
       AND progress.lesson_id = lesson.id
       AND progress.learner_id = v_learner_id
       AND progress.enrolment_id =
            p_enrolment_id
    WHERE lesson.organisation_id =
            v_organisation_id
      AND lesson.course_id = p_course_id
      AND lesson.is_published = true
      AND progress.status = 'COMPLETED'
      AND progress.progress_percent = 100;

    IF v_completed_lesson_count <>
       v_published_lesson_count THEN
        RAISE EXCEPTION
            USING
                ERRCODE = 'P0001',
                MESSAGE =
                    'All published Academy lessons must be completed';
    END IF;

    UPDATE nabuuma.academy_enrolments
    SET
        status = 'COMPLETED',
        completed_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE academy_enrolments.id = p_enrolment_id
      AND academy_enrolments.organisation_id =
            v_organisation_id
      AND academy_enrolments.learner_id =
            v_learner_id
      AND academy_enrolments.course_id =
            p_course_id;

    RETURN QUERY
    INSERT INTO nabuuma.academy_certificates
        AS certificate (
            organisation_id,
            learner_id,
            course_id,
            enrolment_id,
            certificate_number,
            issued_by_id,
            metadata
        )
    VALUES (
        v_organisation_id,
        v_learner_id,
        p_course_id,
        p_enrolment_id,
        'NAB-' || pg_catalog.replace(
            pg_catalog.gen_random_uuid()::TEXT,
            '-',
            ''
        ),
        NULL,
        pg_catalog.jsonb_build_object(
            'completion_source',
            'academy_course_completion'
        )
    )
    RETURNING
        certificate.id,
        certificate.organisation_id,
        certificate.learner_id,
        certificate.course_id,
        certificate.enrolment_id,
        certificate.certificate_number,
        certificate.issued_at,
        certificate.issued_by_id,
        certificate.metadata;
END;
$function$;

REVOKE ALL
ON FUNCTION nabuuma.complete_academy_course(
    UUID,
    UUID
)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION nabuuma.complete_academy_course(
    UUID,
    UUID
)
TO nabuuma_app;

COMMENT ON FUNCTION
    nabuuma.complete_academy_course(UUID, UUID)
IS
'Atomically completes an authenticated learner-owned Academy enrolment and issues one immutable certificate after all published lessons reach COMPLETED/100%.';

COMMIT;
