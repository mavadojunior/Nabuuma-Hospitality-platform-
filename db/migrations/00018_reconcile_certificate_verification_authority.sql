BEGIN;

SET LOCAL search_path = pg_catalog;

-- Canonicalise the privacy-safe public certificate verification capability.
--
-- nabuuma_auth_owner is intentionally:
--   NOLOGIN
--   NOSUPERUSER
--   NOINHERIT
--   NOBYPASSRLS
--
-- The role receives only the columns consumed by
-- verify_academy_certificate(TEXT). It must never receive whole-table
-- SELECT privileges on Academy certificate data.

DO $verification$
DECLARE
    owner_role pg_catalog.pg_roles%ROWTYPE;
BEGIN
    SELECT *
    INTO STRICT owner_role
    FROM pg_catalog.pg_roles
    WHERE rolname = 'nabuuma_auth_owner';

    IF owner_role.rolcanlogin
       OR owner_role.rolsuper
       OR owner_role.rolinherit
       OR owner_role.rolcreaterole
       OR owner_role.rolcreatedb
       OR owner_role.rolreplication
       OR owner_role.rolbypassrls
    THEN
        RAISE EXCEPTION
            'nabuuma_auth_owner has unsafe role attributes';
    END IF;

    IF pg_catalog.pg_has_role(
        'nabuuma_app',
        'nabuuma_auth_owner',
        'MEMBER'
    ) THEN
        RAISE EXCEPTION
            'nabuuma_app must not be a member of nabuuma_auth_owner';
    END IF;

    IF pg_catalog.pg_has_role(
        'nabuuma_certificate_verifier',
        'nabuuma_auth_owner',
        'MEMBER'
    ) THEN
        RAISE EXCEPTION
            'nabuuma_certificate_verifier must not be a member of nabuuma_auth_owner';
    END IF;

    IF pg_catalog.pg_has_role(
        'nabuuma_runtime',
        'nabuuma_auth_owner',
        'MEMBER'
    ) THEN
        RAISE EXCEPTION
            'nabuuma_runtime must not be a member of nabuuma_auth_owner';
    END IF;
END
$verification$;

GRANT USAGE
ON SCHEMA nabuuma
TO nabuuma_auth_owner;

REVOKE CREATE
ON SCHEMA nabuuma
FROM nabuuma_auth_owner;

-- Explicitly prevent accidental broad table privileges before restoring the
-- exact column-level capability used by the verification function.
REVOKE ALL
ON TABLE nabuuma.academy_certificates
FROM nabuuma_auth_owner;

REVOKE ALL
ON TABLE nabuuma.academy_courses
FROM nabuuma_auth_owner;

REVOKE ALL
ON TABLE nabuuma.academy_certificate_revocations
FROM nabuuma_auth_owner;

GRANT SELECT (
    id,
    organisation_id,
    course_id,
    certificate_number,
    issued_at
)
ON TABLE nabuuma.academy_certificates
TO nabuuma_auth_owner;

GRANT SELECT (
    id,
    organisation_id,
    title
)
ON TABLE nabuuma.academy_courses
TO nabuuma_auth_owner;

GRANT SELECT (
    id,
    organisation_id,
    certificate_id,
    revoked_at
)
ON TABLE nabuuma.academy_certificate_revocations
TO nabuuma_auth_owner;

-- The function owner is subject to FORCE ROW LEVEL SECURITY on these
-- application tables, so provide explicit verifier-only SELECT policies.
DROP POLICY IF EXISTS
    academy_certificates_verifier_select
ON nabuuma.academy_certificates;

CREATE POLICY
    academy_certificates_verifier_select
ON nabuuma.academy_certificates
FOR SELECT
TO nabuuma_auth_owner
USING (true);

DROP POLICY IF EXISTS
    academy_courses_verifier_select
ON nabuuma.academy_courses;

CREATE POLICY
    academy_courses_verifier_select
ON nabuuma.academy_courses
FOR SELECT
TO nabuuma_auth_owner
USING (true);

DROP POLICY IF EXISTS
    academy_certificate_revocations_verifier_select
ON nabuuma.academy_certificate_revocations;

CREATE POLICY
    academy_certificate_revocations_verifier_select
ON nabuuma.academy_certificate_revocations
FOR SELECT
TO nabuuma_auth_owner
USING (true);

ALTER FUNCTION
    nabuuma.verify_academy_certificate(TEXT)
OWNER TO nabuuma_auth_owner;

ALTER FUNCTION
    nabuuma.verify_academy_certificate(TEXT)
SECURITY DEFINER;

ALTER FUNCTION
    nabuuma.verify_academy_certificate(TEXT)
SET search_path = pg_catalog;

REVOKE ALL
ON FUNCTION nabuuma.verify_academy_certificate(TEXT)
FROM PUBLIC;

REVOKE ALL
ON FUNCTION nabuuma.verify_academy_certificate(TEXT)
FROM nabuuma_app;

REVOKE ALL
ON FUNCTION nabuuma.verify_academy_certificate(TEXT)
FROM nabuuma_runtime;

GRANT EXECUTE
ON FUNCTION nabuuma.verify_academy_certificate(TEXT)
TO nabuuma_certificate_verifier;

DO $verification$
DECLARE
    function_owner text;
    function_security_definer boolean;
    function_config text[];
BEGIN
    SELECT
        pg_catalog.pg_get_userbyid(function_proc.proowner),
        function_proc.prosecdef,
        function_proc.proconfig
    INTO STRICT
        function_owner,
        function_security_definer,
        function_config
    FROM pg_catalog.pg_proc AS function_proc
    WHERE function_proc.oid =
        'nabuuma.verify_academy_certificate(text)'::regprocedure;

    IF function_owner IS DISTINCT FROM 'nabuuma_auth_owner'
    THEN
        RAISE EXCEPTION
            'Certificate verifier function owner is incorrect';
    END IF;

    IF NOT function_security_definer THEN
        RAISE EXCEPTION
            'Certificate verifier must remain SECURITY DEFINER';
    END IF;

    IF function_config IS NULL
       OR NOT (
           'search_path=pg_catalog' =
           ANY(function_config)
       )
    THEN
        RAISE EXCEPTION
            'Certificate verifier search_path is not hardened';
    END IF;

    IF pg_catalog.has_table_privilege(
        'nabuuma_auth_owner',
        'nabuuma.academy_certificates',
        'SELECT'
    ) THEN
        RAISE EXCEPTION
            'Certificate verifier owner has broad certificate SELECT';
    END IF;

    IF pg_catalog.has_table_privilege(
        'nabuuma_auth_owner',
        'nabuuma.academy_courses',
        'SELECT'
    ) THEN
        RAISE EXCEPTION
            'Certificate verifier owner has broad course SELECT';
    END IF;

    IF pg_catalog.has_table_privilege(
        'nabuuma_auth_owner',
        'nabuuma.academy_certificate_revocations',
        'SELECT'
    ) THEN
        RAISE EXCEPTION
            'Certificate verifier owner has broad revocation SELECT';
    END IF;

    IF NOT pg_catalog.has_column_privilege(
        'nabuuma_auth_owner',
        'nabuuma.academy_certificates',
        'id',
        'SELECT'
    )
       OR NOT pg_catalog.has_column_privilege(
           'nabuuma_auth_owner',
           'nabuuma.academy_certificates',
           'organisation_id',
           'SELECT'
       )
       OR NOT pg_catalog.has_column_privilege(
           'nabuuma_auth_owner',
           'nabuuma.academy_certificates',
           'course_id',
           'SELECT'
       )
       OR NOT pg_catalog.has_column_privilege(
           'nabuuma_auth_owner',
           'nabuuma.academy_certificates',
           'certificate_number',
           'SELECT'
       )
       OR NOT pg_catalog.has_column_privilege(
           'nabuuma_auth_owner',
           'nabuuma.academy_certificates',
           'issued_at',
           'SELECT'
       )
    THEN
        RAISE EXCEPTION
            'Certificate verifier certificate-column grants are incomplete';
    END IF;

    IF pg_catalog.has_column_privilege(
        'nabuuma_auth_owner',
        'nabuuma.academy_certificates',
        'learner_id',
        'SELECT'
    )
       OR pg_catalog.has_column_privilege(
           'nabuuma_auth_owner',
           'nabuuma.academy_certificates',
           'enrolment_id',
           'SELECT'
       )
       OR pg_catalog.has_column_privilege(
           'nabuuma_auth_owner',
           'nabuuma.academy_certificates',
           'issued_by_id',
           'SELECT'
       )
       OR pg_catalog.has_column_privilege(
           'nabuuma_auth_owner',
           'nabuuma.academy_certificates',
           'metadata',
           'SELECT'
       )
    THEN
        RAISE EXCEPTION
            'Certificate verifier owner has sensitive certificate-column access';
    END IF;

    IF NOT pg_catalog.has_function_privilege(
        'nabuuma_certificate_verifier',
        'nabuuma.verify_academy_certificate(text)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION
            'Certificate verifier role lacks EXECUTE';
    END IF;

    IF pg_catalog.has_function_privilege(
        'nabuuma_app',
        'nabuuma.verify_academy_certificate(text)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION
            'nabuuma_app unexpectedly has verifier EXECUTE';
    END IF;

    IF pg_catalog.has_function_privilege(
        'nabuuma_runtime',
        'nabuuma.verify_academy_certificate(text)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION
            'nabuuma_runtime unexpectedly has verifier EXECUTE';
    END IF;
END
$verification$;

COMMIT;
