BEGIN;

SET LOCAL search_path = pg_catalog;

-- Permit schema name resolution and only the privacy-safe verification
-- function. USAGE does not grant table access or role membership.
GRANT USAGE ON SCHEMA nabuuma TO nabuuma_runtime;

GRANT EXECUTE
ON FUNCTION nabuuma.verify_academy_certificate(TEXT)
TO nabuuma_runtime;

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

    IF function_owner IS DISTINCT FROM 'nabuuma_auth_owner' THEN
        RAISE EXCEPTION
            'Certificate verification function owner is incorrect';
    END IF;

    IF NOT function_security_definer THEN
        RAISE EXCEPTION
            'Certificate verification must remain SECURITY DEFINER';
    END IF;

    IF function_config IS NULL
       OR NOT ('search_path=pg_catalog' = ANY(function_config)) THEN
        RAISE EXCEPTION
            'Certificate verification search_path is not hardened';
    END IF;

    IF NOT pg_catalog.has_schema_privilege(
        'nabuuma_runtime',
        'nabuuma',
        'USAGE'
    ) THEN
        RAISE EXCEPTION
            'Runtime lacks schema USAGE for certificate verification';
    END IF;

    IF NOT pg_catalog.has_function_privilege(
        'nabuuma_runtime',
        'nabuuma.verify_academy_certificate(text)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION
            'Runtime lacks certificate verification EXECUTE';
    END IF;

    IF pg_catalog.pg_has_role(
        'nabuuma_runtime',
        'nabuuma_certificate_verifier',
        'MEMBER'
    ) THEN
        RAISE EXCEPTION
            'Runtime must not become a certificate verifier role member';
    END IF;

    IF pg_catalog.has_table_privilege(
        'nabuuma_runtime',
        'nabuuma.academy_certificates',
        'SELECT'
    ) THEN
        RAISE EXCEPTION
            'Runtime must not receive direct certificate table SELECT';
    END IF;
END
$verification$;

COMMIT;
