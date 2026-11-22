BEGIN;

SET LOCAL search_path = pg_catalog;

DO $migration$
DECLARE
    role_state pg_catalog.pg_roles%ROWTYPE;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_roles
        WHERE rolname =
            'nabuuma_certificate_revoke_owner'
    ) THEN
        CREATE ROLE nabuuma_certificate_revoke_owner
            NOLOGIN
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE
            NOINHERIT
            NOREPLICATION
            NOBYPASSRLS;
    END IF;

    SELECT *
    INTO STRICT role_state
    FROM pg_catalog.pg_roles
    WHERE rolname =
        'nabuuma_certificate_revoke_owner';

    IF role_state.rolcanlogin
       OR role_state.rolsuper
       OR role_state.rolcreatedb
       OR role_state.rolcreaterole
       OR role_state.rolinherit
       OR role_state.rolreplication
       OR role_state.rolbypassrls
    THEN
        RAISE EXCEPTION
            'Certificate revocation owner has unsafe role attributes';
    END IF;

    IF pg_catalog.pg_has_role(
        'nabuuma_app',
        'nabuuma_certificate_revoke_owner',
        'MEMBER'
    ) THEN
        RAISE EXCEPTION
            'nabuuma_app must not be a member of the revocation owner';
    END IF;

    IF pg_catalog.pg_has_role(
        'nabuuma_runtime',
        'nabuuma_certificate_revoke_owner',
        'MEMBER'
    ) THEN
        RAISE EXCEPTION
            'nabuuma_runtime must not be a member of the revocation owner';
    END IF;

    IF pg_catalog.pg_has_role(
        'nabuuma_certificate_verifier',
        'nabuuma_certificate_revoke_owner',
        'MEMBER'
    ) THEN
        RAISE EXCEPTION
            'Certificate verifier must not be a member of the revocation owner';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS table_class
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid =
             table_class.relnamespace
        WHERE namespace.nspname = 'nabuuma'
          AND table_class.relname IN (
              'academy_certificates',
              'academy_certificate_revocations'
          )
          AND table_class.relrowsecurity
          AND table_class.relforcerowsecurity
        GROUP BY namespace.nspname
        HAVING count(*) = 2
    ) THEN
        RAISE EXCEPTION
            'Certificate tables must have enabled and forced RLS';
    END IF;
END
$migration$;

GRANT USAGE, CREATE
ON SCHEMA nabuuma
TO nabuuma_certificate_revoke_owner;

-- Fail closed against accidental broad privileges before establishing the
-- exact column-level revocation capability.
REVOKE ALL
ON TABLE nabuuma.academy_certificates
FROM nabuuma_certificate_revoke_owner;

REVOKE ALL
ON TABLE nabuuma.academy_certificate_revocations
FROM nabuuma_certificate_revoke_owner;

GRANT SELECT (
    id,
    organisation_id,
    learner_id,
    certificate_number
)
ON TABLE nabuuma.academy_certificates
TO nabuuma_certificate_revoke_owner;

GRANT SELECT (
    certificate_id,
    revoked_at
)
ON TABLE nabuuma.academy_certificate_revocations
TO nabuuma_certificate_revoke_owner;

GRANT INSERT (
    organisation_id,
    certificate_id,
    revoked_by_id,
    reason
)
ON TABLE nabuuma.academy_certificate_revocations
TO nabuuma_certificate_revoke_owner;

GRANT EXECUTE
ON FUNCTION nabuuma.current_app_user_id()
TO nabuuma_certificate_revoke_owner;

GRANT EXECUTE
ON FUNCTION nabuuma.current_app_organisation_id()
TO nabuuma_certificate_revoke_owner;

GRANT EXECUTE
ON FUNCTION nabuuma.is_authorized_assessor(
    UUID,
    UUID,
    UUID
)
TO nabuuma_certificate_revoke_owner;

DROP POLICY IF EXISTS
    academy_certificates_revoker_select
ON nabuuma.academy_certificates;

CREATE POLICY
    academy_certificates_revoker_select
ON nabuuma.academy_certificates
FOR SELECT
TO nabuuma_certificate_revoke_owner
USING (
    organisation_id =
        nabuuma.current_app_organisation_id()
);

DROP POLICY IF EXISTS
    academy_certificate_revocations_revoker_select
ON nabuuma.academy_certificate_revocations;

CREATE POLICY
    academy_certificate_revocations_revoker_select
ON nabuuma.academy_certificate_revocations
FOR SELECT
TO nabuuma_certificate_revoke_owner
USING (
    organisation_id =
        nabuuma.current_app_organisation_id()
);

DROP POLICY IF EXISTS
    academy_certificate_revocations_revoker_insert
ON nabuuma.academy_certificate_revocations;

CREATE POLICY
    academy_certificate_revocations_revoker_insert
ON nabuuma.academy_certificate_revocations
FOR INSERT
TO nabuuma_certificate_revoke_owner
WITH CHECK (
    organisation_id =
        nabuuma.current_app_organisation_id()
    AND revoked_by_id =
        nabuuma.current_app_user_id()
    AND EXISTS (
        SELECT 1
        FROM nabuuma.academy_certificates
            AS certificate
        WHERE certificate.organisation_id =
            academy_certificate_revocations.organisation_id
          AND certificate.id =
            academy_certificate_revocations.certificate_id
          AND nabuuma.is_authorized_assessor(
              certificate.organisation_id,
              academy_certificate_revocations.revoked_by_id,
              certificate.learner_id
          )
    )
);

ALTER FUNCTION nabuuma.revoke_academy_certificate(
    TEXT,
    TEXT
)
OWNER TO nabuuma_certificate_revoke_owner;

ALTER FUNCTION nabuuma.revoke_academy_certificate(
    TEXT,
    TEXT
)
SECURITY DEFINER;

ALTER FUNCTION nabuuma.revoke_academy_certificate(
    TEXT,
    TEXT
)
SET search_path = pg_catalog;

ALTER FUNCTION
    nabuuma.prevent_certificate_revocation_mutation()
OWNER TO nabuuma_certificate_revoke_owner;

ALTER FUNCTION
    nabuuma.prevent_certificate_revocation_mutation()
SECURITY INVOKER;

ALTER FUNCTION
    nabuuma.prevent_certificate_revocation_mutation()
SET search_path = pg_catalog;

REVOKE CREATE
ON SCHEMA nabuuma
FROM nabuuma_certificate_revoke_owner;

REVOKE ALL
ON FUNCTION nabuuma.revoke_academy_certificate(
    TEXT,
    TEXT
)
FROM PUBLIC;

REVOKE ALL
ON FUNCTION nabuuma.revoke_academy_certificate(
    TEXT,
    TEXT
)
FROM nabuuma_runtime;

REVOKE ALL
ON FUNCTION nabuuma.revoke_academy_certificate(
    TEXT,
    TEXT
)
FROM nabuuma_certificate_verifier;

GRANT EXECUTE
ON FUNCTION nabuuma.revoke_academy_certificate(
    TEXT,
    TEXT
)
TO nabuuma_app;

REVOKE ALL
ON FUNCTION
    nabuuma.prevent_certificate_revocation_mutation()
FROM PUBLIC;

DO $verification$
DECLARE
    revoke_owner text;
    trigger_owner text;
    revoke_security_definer boolean;
    trigger_security_definer boolean;
    revoke_config text[];
    trigger_config text[];
BEGIN
    SELECT
        pg_catalog.pg_get_userbyid(
            function_proc.proowner
        ),
        function_proc.prosecdef,
        function_proc.proconfig
    INTO STRICT
        revoke_owner,
        revoke_security_definer,
        revoke_config
    FROM pg_catalog.pg_proc AS function_proc
    WHERE function_proc.oid =
        'nabuuma.revoke_academy_certificate(text,text)'::regprocedure;

    SELECT
        pg_catalog.pg_get_userbyid(
            function_proc.proowner
        ),
        function_proc.prosecdef,
        function_proc.proconfig
    INTO STRICT
        trigger_owner,
        trigger_security_definer,
        trigger_config
    FROM pg_catalog.pg_proc AS function_proc
    WHERE function_proc.oid =
        'nabuuma.prevent_certificate_revocation_mutation()'::regprocedure;

    IF revoke_owner IS DISTINCT FROM
        'nabuuma_certificate_revoke_owner'
    THEN
        RAISE EXCEPTION
            'Certificate revocation function owner is incorrect';
    END IF;

    IF trigger_owner IS DISTINCT FROM
        'nabuuma_certificate_revoke_owner'
    THEN
        RAISE EXCEPTION
            'Certificate revocation trigger owner is incorrect';
    END IF;

    IF NOT revoke_security_definer THEN
        RAISE EXCEPTION
            'Certificate revocation function must be SECURITY DEFINER';
    END IF;

    IF trigger_security_definer THEN
        RAISE EXCEPTION
            'Certificate revocation trigger must be SECURITY INVOKER';
    END IF;

    IF revoke_config IS NULL
       OR NOT (
           'search_path=pg_catalog' =
           ANY(revoke_config)
       )
       OR trigger_config IS NULL
       OR NOT (
           'search_path=pg_catalog' =
           ANY(trigger_config)
       )
    THEN
        RAISE EXCEPTION
            'Certificate revocation function search_path is not hardened';
    END IF;

    IF pg_catalog.has_table_privilege(
        'nabuuma_certificate_revoke_owner',
        'nabuuma.academy_certificates',
        'SELECT'
    ) THEN
        RAISE EXCEPTION
            'Revocation owner has broad certificate SELECT';
    END IF;

    IF pg_catalog.has_table_privilege(
        'nabuuma_certificate_revoke_owner',
        'nabuuma.academy_certificate_revocations',
        'SELECT'
    ) OR pg_catalog.has_table_privilege(
        'nabuuma_certificate_revoke_owner',
        'nabuuma.academy_certificate_revocations',
        'INSERT'
    ) THEN
        RAISE EXCEPTION
            'Revocation owner has broad revocation-table privileges';
    END IF;

    IF NOT pg_catalog.has_column_privilege(
        'nabuuma_certificate_revoke_owner',
        'nabuuma.academy_certificates',
        'learner_id',
        'SELECT'
    ) OR NOT pg_catalog.has_column_privilege(
        'nabuuma_certificate_revoke_owner',
        'nabuuma.academy_certificate_revocations',
        'certificate_id',
        'SELECT'
    ) OR NOT pg_catalog.has_column_privilege(
        'nabuuma_certificate_revoke_owner',
        'nabuuma.academy_certificate_revocations',
        'reason',
        'INSERT'
    ) THEN
        RAISE EXCEPTION
            'Certificate revocation column privileges are incomplete';
    END IF;

    IF pg_catalog.has_column_privilege(
        'nabuuma_certificate_revoke_owner',
        'nabuuma.academy_certificates',
        'metadata',
        'SELECT'
    ) OR pg_catalog.has_column_privilege(
        'nabuuma_certificate_revoke_owner',
        'nabuuma.academy_certificate_revocations',
        'reason',
        'SELECT'
    ) OR pg_catalog.has_column_privilege(
        'nabuuma_certificate_revoke_owner',
        'nabuuma.academy_certificate_revocations',
        'created_at',
        'INSERT'
    ) THEN
        RAISE EXCEPTION
            'Certificate revocation owner has excessive column privileges';
    END IF;

    IF NOT pg_catalog.has_function_privilege(
        'nabuuma_app',
        'nabuuma.revoke_academy_certificate(text,text)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION
            'nabuuma_app lacks certificate revocation EXECUTE';
    END IF;

    IF pg_catalog.has_function_privilege(
        'nabuuma_runtime',
        'nabuuma.revoke_academy_certificate(text,text)',
        'EXECUTE'
    ) OR pg_catalog.has_function_privilege(
        'nabuuma_certificate_verifier',
        'nabuuma.revoke_academy_certificate(text,text)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION
            'Unauthorised role has certificate revocation EXECUTE';
    END IF;

    IF pg_catalog.has_schema_privilege(
        'nabuuma_certificate_revoke_owner',
        'nabuuma',
        'CREATE'
    ) THEN
        RAISE EXCEPTION
            'Revocation owner unexpectedly retains schema CREATE';
    END IF;

    IF (
        SELECT count(*)
        FROM pg_catalog.pg_policies
        WHERE schemaname = 'nabuuma'
          AND policyname IN (
              'academy_certificates_revoker_select',
              'academy_certificate_revocations_revoker_select',
              'academy_certificate_revocations_revoker_insert'
          )
          AND roles =
              ARRAY[
                  'nabuuma_certificate_revoke_owner'
              ]::name[]
    ) <> 3 THEN
        RAISE EXCEPTION
            'Certificate revocation RLS policies are incomplete';
    END IF;
END
$verification$;

COMMIT;
