BEGIN;

-- Correct the course-to-lesson tenant correlation.
-- Explicit outer-table qualification prevents accidental inner-column
-- resolution in the EXISTS subquery.

DROP POLICY academy_lessons_select
ON nabuuma.academy_lessons;

CREATE POLICY academy_lessons_select
ON nabuuma.academy_lessons
FOR SELECT
TO nabuuma_app
USING (
    academy_lessons.organisation_id =
        nabuuma.current_app_organisation_id()
    AND academy_lessons.is_published
    AND nabuuma.is_active_member(
        academy_lessons.organisation_id,
        nabuuma.current_app_user_id()
    )
    AND EXISTS (
        SELECT 1
        FROM nabuuma.academy_courses AS course
        WHERE course.id = academy_lessons.course_id
          AND course.organisation_id =
              academy_lessons.organisation_id
          AND course.is_published
    )
);

-- Correct the course-to-enrolment tenant correlation.
-- Preserve the existing learner, membership, status and publication checks.

DROP POLICY academy_enrolments_insert
ON nabuuma.academy_enrolments;

CREATE POLICY academy_enrolments_insert
ON nabuuma.academy_enrolments
FOR INSERT
TO nabuuma_app
WITH CHECK (
    academy_enrolments.organisation_id =
        nabuuma.current_app_organisation_id()
    AND academy_enrolments.learner_id =
        nabuuma.current_app_user_id()
    AND academy_enrolments.status = 'ACTIVE'
    AND academy_enrolments.completed_at IS NULL
    AND nabuuma.is_active_member(
        academy_enrolments.organisation_id,
        nabuuma.current_app_user_id()
    )
    AND EXISTS (
        SELECT 1
        FROM nabuuma.academy_courses AS course
        WHERE course.id = academy_enrolments.course_id
          AND course.organisation_id =
              academy_enrolments.organisation_id
          AND course.is_published
    )
);

COMMIT;
