BEGIN;

DO $migration$
DECLARE
    role_login boolean;
    role_super boolean;
    role_create_role boolean;
    role_create_db boolean;
    role_replication boolean;
    role_bypass_rls boolean;
BEGIN
    SELECT
        rolcanlogin,
        rolsuper,
        rolcreaterole,
        rolcreatedb,
        rolreplication,
        rolbypassrls
    INTO
        role_login,
        role_super,
        role_create_role,
        role_create_db,
        role_replication,
        role_bypass_rls
    FROM pg_catalog.pg_roles
    WHERE rolname = 'nabuuma_auth_owner';

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Required role nabuuma_auth_owner does not exist';
    END IF;

    IF role_login
       OR role_super
       OR role_create_role
       OR role_create_db
       OR role_replication
       OR role_bypass_rls
    THEN
        RAISE EXCEPTION
            'nabuuma_auth_owner has unsafe role attributes';
    END IF;
END
$migration$;

GRANT USAGE
ON SCHEMA nabuuma
TO nabuuma_auth_owner;

REVOKE CREATE
ON SCHEMA nabuuma
FROM nabuuma_auth_owner;

ALTER TABLE nabuuma.organisation_memberships
    OWNER TO nabuuma_auth_owner;

ALTER TABLE nabuuma.trainer_learner_authorizations
    OWNER TO nabuuma_auth_owner;

ALTER FUNCTION nabuuma.is_active_member(UUID, UUID)
    OWNER TO nabuuma_auth_owner;

ALTER FUNCTION nabuuma.is_authorized_assessor(
    UUID,
    UUID,
    UUID
)
    OWNER TO nabuuma_auth_owner;

REVOKE ALL
ON FUNCTION nabuuma.is_active_member(UUID, UUID)
FROM PUBLIC;

REVOKE ALL
ON FUNCTION nabuuma.is_authorized_assessor(
    UUID,
    UUID,
    UUID
)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION nabuuma.is_active_member(UUID, UUID)
TO nabuuma_app;

GRANT EXECUTE
ON FUNCTION nabuuma.is_authorized_assessor(
    UUID,
    UUID,
    UUID
)
TO nabuuma_app;

DO $migration$
DECLARE
    membership_owner text;
    authorization_owner text;
    active_member_owner text;
    assessor_owner text;
BEGIN
    SELECT pg_catalog.pg_get_userbyid(c.relowner)
    INTO membership_owner
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n
      ON n.oid = c.relnamespace
    WHERE n.nspname = 'nabuuma'
      AND c.relname = 'organisation_memberships'
      AND c.relkind IN ('r', 'p');

    SELECT pg_catalog.pg_get_userbyid(c.relowner)
    INTO authorization_owner
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n
      ON n.oid = c.relnamespace
    WHERE n.nspname = 'nabuuma'
      AND c.relname = 'trainer_learner_authorizations'
      AND c.relkind IN ('r', 'p');

    SELECT pg_catalog.pg_get_userbyid(p.proowner)
    INTO active_member_owner
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid =
        'nabuuma.is_active_member(uuid,uuid)'::regprocedure;

    SELECT pg_catalog.pg_get_userbyid(p.proowner)
    INTO assessor_owner
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid =
        'nabuuma.is_authorized_assessor(uuid,uuid,uuid)'::regprocedure;

    IF membership_owner IS DISTINCT FROM 'nabuuma_auth_owner'
       OR authorization_owner IS DISTINCT FROM 'nabuuma_auth_owner'
       OR active_member_owner IS DISTINCT FROM 'nabuuma_auth_owner'
       OR assessor_owner IS DISTINCT FROM 'nabuuma_auth_owner'
    THEN
        RAISE EXCEPTION
            'Authorization ownership reconciliation failed';
    END IF;

    IF NOT pg_catalog.has_schema_privilege(
        'nabuuma_auth_owner',
        'nabuuma',
        'USAGE'
    ) THEN
        RAISE EXCEPTION
            'nabuuma_auth_owner lacks schema USAGE';
    END IF;

    IF pg_catalog.has_schema_privilege(
        'nabuuma_auth_owner',
        'nabuuma',
        'CREATE'
    ) THEN
        RAISE EXCEPTION
            'nabuuma_auth_owner unexpectedly has schema CREATE';
    END IF;

    IF pg_catalog.pg_has_role(
        'nabuuma_app',
        'nabuuma_auth_owner',
        'MEMBER'
    ) THEN
        RAISE EXCEPTION
            'nabuuma_app must not be a member of nabuuma_auth_owner';
    END IF;

    IF NOT pg_catalog.has_function_privilege(
        'nabuuma_app',
        'nabuuma.is_active_member(uuid,uuid)',
        'EXECUTE'
    ) OR NOT pg_catalog.has_function_privilege(
        'nabuuma_app',
        'nabuuma.is_authorized_assessor(uuid,uuid,uuid)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION
            'Required application function EXECUTE grants are missing';
    END IF;
END
$migration$;

COMMIT;
