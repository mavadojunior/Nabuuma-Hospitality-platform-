BEGIN;

-- Dedicated non-login owner for the authorization tables and helpers.
CREATE ROLE nabuuma_auth_owner
    NOLOGIN
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE
    NOINHERIT
    NOREPLICATION
    NOBYPASSRLS;

-- PostgreSQL requires CREATE on the containing schema when ownership
-- is transferred. This permission is temporary.
GRANT USAGE, CREATE ON SCHEMA nabuuma TO nabuuma_auth_owner;

-- Transfer only the two authorization tables.
ALTER TABLE nabuuma.organisation_memberships
    OWNER TO nabuuma_auth_owner;

ALTER TABLE nabuuma.trainer_learner_authorizations
    OWNER TO nabuuma_auth_owner;

-- Transfer only the two SECURITY DEFINER helper functions.
ALTER FUNCTION nabuuma.is_active_member(uuid, uuid)
    OWNER TO nabuuma_auth_owner;

ALTER FUNCTION nabuuma.is_authorized_assessor(uuid, uuid, uuid)
    OWNER TO nabuuma_auth_owner;

-- The role must not be able to create additional schema objects.
REVOKE CREATE ON SCHEMA nabuuma FROM nabuuma_auth_owner;

-- Preserve the existing application execution grants explicitly.
REVOKE ALL ON FUNCTION nabuuma.is_active_member(uuid, uuid)
    FROM PUBLIC;

REVOKE ALL ON FUNCTION nabuuma.is_authorized_assessor(uuid, uuid, uuid)
    FROM PUBLIC;

GRANT EXECUTE ON FUNCTION nabuuma.is_active_member(uuid, uuid)
    TO nabuuma_app;

GRANT EXECUTE ON FUNCTION nabuuma.is_authorized_assessor(uuid, uuid, uuid)
    TO nabuuma_app;

-- Verify the ownership and security boundary before committing.
DO $verification$
DECLARE
    v_role pg_roles%ROWTYPE;
BEGIN
    SELECT *
    INTO STRICT v_role
    FROM pg_roles
    WHERE rolname = 'nabuuma_auth_owner';

    IF v_role.rolcanlogin
       OR v_role.rolsuper
       OR v_role.rolcreatedb
       OR v_role.rolcreaterole
       OR v_role.rolreplication
       OR v_role.rolbypassrls
       OR v_role.rolinherit THEN
        RAISE EXCEPTION
            'Authorization owner role has unsafe attributes';
    END IF;

    IF has_schema_privilege(
        'nabuuma_auth_owner', 'nabuuma', 'CREATE'
    ) THEN
        RAISE EXCEPTION
            'Authorization owner unexpectedly retains schema CREATE';
    END IF;

    IF NOT has_schema_privilege(
        'nabuuma_auth_owner', 'nabuuma', 'USAGE'
    ) THEN
        RAISE EXCEPTION
            'Authorization owner lacks schema USAGE';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_roles r ON r.oid = c.relowner
        WHERE n.nspname = 'nabuuma'
          AND c.relname = 'organisation_memberships'
          AND r.rolname = 'nabuuma_auth_owner'
          AND c.relrowsecurity
          AND NOT c.relforcerowsecurity
    ) THEN
        RAISE EXCEPTION
            'Membership table ownership or RLS state is incorrect';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_roles r ON r.oid = c.relowner
        WHERE n.nspname = 'nabuuma'
          AND c.relname = 'trainer_learner_authorizations'
          AND r.rolname = 'nabuuma_auth_owner'
          AND c.relrowsecurity
          AND NOT c.relforcerowsecurity
    ) THEN
        RAISE EXCEPTION
            'Trainer authorization table ownership or RLS state is incorrect';
    END IF;

    IF (
        SELECT count(*)
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        JOIN pg_roles r ON r.oid = p.proowner
        WHERE n.nspname = 'nabuuma'
          AND p.proname IN (
              'is_active_member',
              'is_authorized_assessor'
          )
          AND r.rolname = 'nabuuma_auth_owner'
          AND p.prosecdef
    ) <> 2 THEN
        RAISE EXCEPTION
            'Expected SECURITY DEFINER helper ownership was not established';
    END IF;

    IF NOT has_table_privilege(
        'nabuuma_app',
        'nabuuma.organisation_memberships',
        'SELECT'
    ) THEN
        RAISE EXCEPTION
            'Application membership SELECT grant was not preserved';
    END IF;

    IF NOT has_function_privilege(
        'nabuuma_app',
        'nabuuma.is_active_member(uuid,uuid)',
        'EXECUTE'
    ) OR NOT has_function_privilege(
        'nabuuma_app',
        'nabuuma.is_authorized_assessor(uuid,uuid,uuid)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION
            'Application helper EXECUTE grants were not preserved';
    END IF;

    IF pg_has_role(
        'nabuuma_app',
        'nabuuma_auth_owner',
        'MEMBER'
    ) THEN
        RAISE EXCEPTION
            'Application role is a member of the authorization owner';
    END IF;
END;
$verification$;

COMMIT;
