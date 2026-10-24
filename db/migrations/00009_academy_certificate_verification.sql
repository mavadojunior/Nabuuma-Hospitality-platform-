BEGIN;

SET LOCAL search_path = pg_catalog;

CREATE FUNCTION nabuuma.verify_academy_certificate(
    p_certificate_number TEXT
)
RETURNS TABLE (
    valid BOOLEAN,
    certificate_number TEXT,
    issued_at TIMESTAMPTZ,
    course_title TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
    SELECT
        true AS valid,
        certificate.certificate_number,
        certificate.issued_at,
        course.title AS course_title
    FROM nabuuma.academy_certificates AS certificate
    INNER JOIN nabuuma.academy_courses AS course
        ON course.organisation_id =
            certificate.organisation_id
       AND course.id = certificate.course_id
    WHERE certificate.certificate_number =
        p_certificate_number
    LIMIT 1
$function$;

REVOKE ALL
ON FUNCTION nabuuma.verify_academy_certificate(TEXT)
FROM PUBLIC;

DO $role_guard$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_roles
        WHERE rolname = 'nabuuma_certificate_verifier'
    ) THEN
        CREATE ROLE nabuuma_certificate_verifier
            NOLOGIN
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE
            NOINHERIT
            NOBYPASSRLS;
    END IF;
END;
$role_guard$;

REVOKE ALL
ON FUNCTION nabuuma.verify_academy_certificate(TEXT)
FROM nabuuma_app;

GRANT USAGE
ON SCHEMA nabuuma
TO nabuuma_certificate_verifier;

GRANT EXECUTE
ON FUNCTION nabuuma.verify_academy_certificate(TEXT)
TO nabuuma_certificate_verifier;

COMMENT ON FUNCTION
nabuuma.verify_academy_certificate(TEXT) IS
'Privacy-safe Academy certificate verification surface exposing no internal identity or tenant identifiers.';

COMMIT;
