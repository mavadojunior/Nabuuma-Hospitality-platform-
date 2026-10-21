/*
Migration: 00008_academy_curriculum_enrolment_certification.sql
Project: Nabuuma Hospitality Platform
Schema: nabuuma
Role: nabuuma_app

Purpose:
  Establish the organisation-scoped Academy curriculum, enrolment,
  lesson-progress and immutable certification foundation.

Security:
  - Every operational record is organisation-scoped.
  - Composite foreign keys enforce tenant and learner consistency.
  - Curriculum is read-only to the application role.
  - Learners can manage only their own enrolment and progress records.
  - Certificates cannot be issued, modified or deleted directly by
    the application role.
  - Row-level security is enabled and forced on every Academy table.

Prerequisites:
  - Schema nabuuma exists.
  - Tables nabuuma.organisations and nabuuma.users exist.
  - Role nabuuma_app exists.
  - Context and membership functions created by earlier migrations exist.
*/

BEGIN;

SET LOCAL search_path = nabuuma, public;

-- ============================================================================
-- 1. CURRICULUM
-- ============================================================================

CREATE TABLE nabuuma.academy_courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL
        REFERENCES nabuuma.organisations(id)
        ON DELETE CASCADE,
    stable_key TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1
        CHECK (version > 0),
    title TEXT NOT NULL
        CHECK (length(btrim(title)) > 0),
    description TEXT NOT NULL DEFAULT '',
    is_published BOOLEAN NOT NULL DEFAULT false,
    created_by_id UUID NOT NULL
        REFERENCES nabuuma.users(id)
        ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (organisation_id, stable_key, version),
    UNIQUE (organisation_id, id)
);

CREATE INDEX idx_academy_courses_org_published
    ON nabuuma.academy_courses(
        organisation_id,
        is_published
    );

CREATE INDEX idx_academy_courses_created_by
    ON nabuuma.academy_courses(created_by_id);


CREATE TABLE nabuuma.academy_lessons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL,
    course_id UUID NOT NULL,
    stable_key TEXT NOT NULL,
    title TEXT NOT NULL
        CHECK (length(btrim(title)) > 0),
    content JSONB NOT NULL DEFAULT '{}'::jsonb,
    sequence_number INTEGER NOT NULL
        CHECK (sequence_number > 0),
    estimated_duration_minutes INTEGER
        CHECK (
            estimated_duration_minutes IS NULL
            OR estimated_duration_minutes > 0
        ),
    is_published BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    FOREIGN KEY (organisation_id, course_id)
        REFERENCES nabuuma.academy_courses(
            organisation_id,
            id
        )
        ON DELETE CASCADE,

    UNIQUE (organisation_id, course_id, stable_key),
    UNIQUE (organisation_id, course_id, sequence_number),
    UNIQUE (organisation_id, course_id, id)
);

CREATE INDEX idx_academy_lessons_course_sequence
    ON nabuuma.academy_lessons(
        organisation_id,
        course_id,
        sequence_number
    );

CREATE INDEX idx_academy_lessons_content_gin
    ON nabuuma.academy_lessons
    USING GIN(content);


-- ============================================================================
-- 2. ENROLMENT
-- ============================================================================

CREATE TABLE nabuuma.academy_enrolments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL,
    learner_id UUID NOT NULL
        REFERENCES nabuuma.users(id)
        ON DELETE RESTRICT,
    course_id UUID NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK (
            status IN (
                'ACTIVE',
                'COMPLETED',
                'CANCELLED'
            )
        ),
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    FOREIGN KEY (organisation_id, course_id)
        REFERENCES nabuuma.academy_courses(
            organisation_id,
            id
        )
        ON DELETE RESTRICT,

    CHECK (
        completed_at IS NULL
        OR status = 'COMPLETED'
    ),

    CHECK (
        completed_at IS NULL
        OR completed_at >= enrolled_at
    ),

    UNIQUE (organisation_id, learner_id, course_id),
    UNIQUE (organisation_id, learner_id, course_id, id)
);

CREATE INDEX idx_academy_enrolments_learner_status
    ON nabuuma.academy_enrolments(
        organisation_id,
        learner_id,
        status
    );

CREATE INDEX idx_academy_enrolments_course_status
    ON nabuuma.academy_enrolments(
        organisation_id,
        course_id,
        status
    );


-- ============================================================================
-- 3. LESSON PROGRESS
-- ============================================================================

CREATE TABLE nabuuma.academy_lesson_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL,
    learner_id UUID NOT NULL,
    course_id UUID NOT NULL,
    enrolment_id UUID NOT NULL,
    lesson_id UUID NOT NULL,
    status TEXT NOT NULL DEFAULT 'NOT_STARTED'
        CHECK (
            status IN (
                'NOT_STARTED',
                'IN_PROGRESS',
                'COMPLETED'
            )
        ),
    progress_percent INTEGER NOT NULL DEFAULT 0
        CHECK (
            progress_percent >= 0
            AND progress_percent <= 100
        ),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    FOREIGN KEY (
        organisation_id,
        learner_id,
        course_id,
        enrolment_id
    )
        REFERENCES nabuuma.academy_enrolments(
            organisation_id,
            learner_id,
            course_id,
            id
        )
        ON DELETE CASCADE,

    FOREIGN KEY (
        organisation_id,
        course_id,
        lesson_id
    )
        REFERENCES nabuuma.academy_lessons(
            organisation_id,
            course_id,
            id
        )
        ON DELETE RESTRICT,

    CHECK (
        status <> 'COMPLETED'
        OR progress_percent = 100
    ),

    CHECK (
        progress_percent = 0
        OR started_at IS NOT NULL
    ),

    CHECK (
        completed_at IS NULL
        OR status = 'COMPLETED'
    ),

    CHECK (
        completed_at IS NULL
        OR started_at IS NOT NULL
    ),

    CHECK (
        completed_at IS NULL
        OR completed_at >= started_at
    ),

    UNIQUE (
        organisation_id,
        learner_id,
        enrolment_id,
        lesson_id
    )
);

CREATE INDEX idx_academy_progress_learner_status
    ON nabuuma.academy_lesson_progress(
        organisation_id,
        learner_id,
        status
    );

CREATE INDEX idx_academy_progress_enrolment
    ON nabuuma.academy_lesson_progress(enrolment_id);

CREATE INDEX idx_academy_progress_lesson
    ON nabuuma.academy_lesson_progress(lesson_id);


-- ============================================================================
-- 4. IMMUTABLE CERTIFICATES
-- ============================================================================

CREATE TABLE nabuuma.academy_certificates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL,
    learner_id UUID NOT NULL,
    course_id UUID NOT NULL,
    enrolment_id UUID NOT NULL,
    certificate_number TEXT NOT NULL
        CHECK (length(btrim(certificate_number)) > 0),
    issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    issued_by_id UUID
        REFERENCES nabuuma.users(id)
        ON DELETE RESTRICT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    FOREIGN KEY (
        organisation_id,
        learner_id,
        course_id,
        enrolment_id
    )
        REFERENCES nabuuma.academy_enrolments(
            organisation_id,
            learner_id,
            course_id,
            id
        )
        ON DELETE RESTRICT,

    UNIQUE (certificate_number),
    UNIQUE (organisation_id, learner_id, course_id)
);

CREATE INDEX idx_academy_certificates_learner
    ON nabuuma.academy_certificates(
        organisation_id,
        learner_id,
        issued_at DESC
    );

CREATE INDEX idx_academy_certificates_course
    ON nabuuma.academy_certificates(
        organisation_id,
        course_id
    );


-- ============================================================================
-- 5. ROW-LEVEL SECURITY
-- ============================================================================

ALTER TABLE nabuuma.academy_courses
    ENABLE ROW LEVEL SECURITY;

ALTER TABLE nabuuma.academy_courses
    FORCE ROW LEVEL SECURITY;

ALTER TABLE nabuuma.academy_lessons
    ENABLE ROW LEVEL SECURITY;

ALTER TABLE nabuuma.academy_lessons
    FORCE ROW LEVEL SECURITY;

ALTER TABLE nabuuma.academy_enrolments
    ENABLE ROW LEVEL SECURITY;

ALTER TABLE nabuuma.academy_enrolments
    FORCE ROW LEVEL SECURITY;

ALTER TABLE nabuuma.academy_lesson_progress
    ENABLE ROW LEVEL SECURITY;

ALTER TABLE nabuuma.academy_lesson_progress
    FORCE ROW LEVEL SECURITY;

ALTER TABLE nabuuma.academy_certificates
    ENABLE ROW LEVEL SECURITY;

ALTER TABLE nabuuma.academy_certificates
    FORCE ROW LEVEL SECURITY;


-- ============================================================================
-- 6. CURRICULUM READ POLICIES
-- ============================================================================

CREATE POLICY academy_courses_select
ON nabuuma.academy_courses
FOR SELECT
TO nabuuma_app
USING (
    organisation_id = nabuuma.current_app_organisation_id()
    AND is_published
    AND nabuuma.is_active_member(
        organisation_id,
        nabuuma.current_app_user_id()
    )
);


CREATE POLICY academy_lessons_select
ON nabuuma.academy_lessons
FOR SELECT
TO nabuuma_app
USING (
    organisation_id = nabuuma.current_app_organisation_id()
    AND is_published
    AND nabuuma.is_active_member(
        organisation_id,
        nabuuma.current_app_user_id()
    )
    AND EXISTS (
        SELECT 1
        FROM nabuuma.academy_courses course
        WHERE course.id = course_id
          AND course.organisation_id = organisation_id
          AND course.is_published
    )
);


-- ============================================================================
-- 7. LEARNER ENROLMENT POLICIES
-- ============================================================================

CREATE POLICY academy_enrolments_select
ON nabuuma.academy_enrolments
FOR SELECT
TO nabuuma_app
USING (
    organisation_id = nabuuma.current_app_organisation_id()
    AND learner_id = nabuuma.current_app_user_id()
    AND nabuuma.is_active_member(
        organisation_id,
        nabuuma.current_app_user_id()
    )
);


CREATE POLICY academy_enrolments_insert
ON nabuuma.academy_enrolments
FOR INSERT
TO nabuuma_app
WITH CHECK (
    organisation_id = nabuuma.current_app_organisation_id()
    AND learner_id = nabuuma.current_app_user_id()
    AND status = 'ACTIVE'
    AND completed_at IS NULL
    AND nabuuma.is_active_member(
        organisation_id,
        nabuuma.current_app_user_id()
    )
    AND EXISTS (
        SELECT 1
        FROM nabuuma.academy_courses course
        WHERE course.id = course_id
          AND course.organisation_id = organisation_id
          AND course.is_published
    )
);


CREATE POLICY academy_enrolments_update
ON nabuuma.academy_enrolments
FOR UPDATE
TO nabuuma_app
USING (
    organisation_id = nabuuma.current_app_organisation_id()
    AND learner_id = nabuuma.current_app_user_id()
    AND nabuuma.is_active_member(
        organisation_id,
        nabuuma.current_app_user_id()
    )
)
WITH CHECK (
    organisation_id = nabuuma.current_app_organisation_id()
    AND learner_id = nabuuma.current_app_user_id()
    AND nabuuma.is_active_member(
        organisation_id,
        nabuuma.current_app_user_id()
    )
);


-- ============================================================================
-- 8. LESSON-PROGRESS POLICIES
-- ============================================================================

CREATE POLICY academy_progress_select
ON nabuuma.academy_lesson_progress
FOR SELECT
TO nabuuma_app
USING (
    organisation_id = nabuuma.current_app_organisation_id()
    AND learner_id = nabuuma.current_app_user_id()
    AND nabuuma.is_active_member(
        organisation_id,
        nabuuma.current_app_user_id()
    )
);


CREATE POLICY academy_progress_insert
ON nabuuma.academy_lesson_progress
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


CREATE POLICY academy_progress_update
ON nabuuma.academy_lesson_progress
FOR UPDATE
TO nabuuma_app
USING (
    organisation_id = nabuuma.current_app_organisation_id()
    AND learner_id = nabuuma.current_app_user_id()
    AND nabuuma.is_active_member(
        organisation_id,
        nabuuma.current_app_user_id()
    )
)
WITH CHECK (
    organisation_id = nabuuma.current_app_organisation_id()
    AND learner_id = nabuuma.current_app_user_id()
    AND nabuuma.is_active_member(
        organisation_id,
        nabuuma.current_app_user_id()
    )
);


-- ============================================================================
-- 9. CERTIFICATE READ POLICY
-- ============================================================================

CREATE POLICY academy_certificates_select
ON nabuuma.academy_certificates
FOR SELECT
TO nabuuma_app
USING (
    organisation_id = nabuuma.current_app_organisation_id()
    AND learner_id = nabuuma.current_app_user_id()
    AND nabuuma.is_active_member(
        organisation_id,
        nabuuma.current_app_user_id()
    )
);


-- ============================================================================
-- 10. LEAST-PRIVILEGE APPLICATION GRANTS
-- ============================================================================

GRANT SELECT
ON TABLE
    nabuuma.academy_courses,
    nabuuma.academy_lessons,
    nabuuma.academy_certificates
TO nabuuma_app;

GRANT SELECT, INSERT, UPDATE
ON TABLE
    nabuuma.academy_enrolments,
    nabuuma.academy_lesson_progress
TO nabuuma_app;

REVOKE INSERT, UPDATE, DELETE
ON TABLE
    nabuuma.academy_courses,
    nabuuma.academy_lessons,
    nabuuma.academy_certificates
FROM nabuuma_app;

REVOKE DELETE
ON TABLE
    nabuuma.academy_enrolments,
    nabuuma.academy_lesson_progress
FROM nabuuma_app;


-- ============================================================================
-- 11. DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE nabuuma.academy_courses IS
'Organisation-scoped, versioned Academy course catalogue. Application access is read-only and limited to published courses.';

COMMENT ON TABLE nabuuma.academy_lessons IS
'Ordered Academy lessons belonging to an organisation-scoped course. Application access is read-only and limited to published curriculum.';

COMMENT ON TABLE nabuuma.academy_enrolments IS
'Learner-owned Academy course enrolments constrained to one organisation and course.';

COMMENT ON TABLE nabuuma.academy_lesson_progress IS
'Learner-owned lesson progress with composite foreign keys enforcing organisation, course, enrolment and lesson consistency.';

COMMENT ON TABLE nabuuma.academy_certificates IS
'Immutable Academy certificates. The application role may read learner-owned certificates but cannot issue, modify or delete them.';

COMMIT;
