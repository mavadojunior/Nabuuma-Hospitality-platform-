BEGIN;

SET LOCAL search_path = pg_catalog;

DO $migration$
DECLARE
    owner_role pg_catalog.pg_roles%ROWTYPE;
    membership_owner text;
    membership_force_rls boolean;
BEGIN
    SELECT * INTO STRICT owner_role
    FROM pg_catalog.pg_roles
    WHERE rolname = 'nabuuma_auth_owner';

    IF owner_role.rolcanlogin OR owner_role.rolsuper OR owner_role.rolcreatedb
       OR owner_role.rolcreaterole OR owner_role.rolreplication
       OR owner_role.rolbypassrls OR owner_role.rolinherit THEN
        RAISE EXCEPTION 'nabuuma_auth_owner has unsafe identity-resolver authority';
    END IF;

    SELECT pg_catalog.pg_get_userbyid(c.relowner), c.relforcerowsecurity
      INTO STRICT membership_owner, membership_force_rls
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'nabuuma'
       AND c.relname = 'organisation_memberships'
       AND c.relkind IN ('r','p');

    IF membership_owner IS DISTINCT FROM 'nabuuma_auth_owner'
       OR membership_force_rls THEN
        RAISE EXCEPTION 'Identity resolver requires canonical non-FORCE membership owner boundary';
    END IF;

    IF pg_catalog.pg_has_role('nabuuma_runtime','nabuuma_auth_owner','MEMBER')
       OR pg_catalog.pg_has_role('nabuuma_app','nabuuma_auth_owner','MEMBER') THEN
        RAISE EXCEPTION 'Runtime/application must not be members of nabuuma_auth_owner';
    END IF;
END
$migration$;

CREATE TABLE nabuuma.external_identities (
    provider TEXT NOT NULL
        CONSTRAINT external_identities_provider_check
        CHECK (provider IN ('AUTH0','SUPABASE')),
    external_subject TEXT NOT NULL
        CONSTRAINT external_identities_subject_check
        CHECK (
            length(external_subject) <= 255
            AND external_subject ~ '[^[:space:]]'
        ),
    user_id UUID NOT NULL
        REFERENCES nabuuma.users(id)
        ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT external_identities_provider_subject_unique
        UNIQUE (provider, external_subject)
);

ALTER TABLE nabuuma.external_identities
    OWNER TO nabuuma_auth_owner;

ALTER TABLE nabuuma.external_identities
    ENABLE ROW LEVEL SECURITY;

ALTER TABLE nabuuma.external_identities
    FORCE ROW LEVEL SECURITY;

CREATE POLICY external_identities_resolver_select
    ON nabuuma.external_identities
    FOR SELECT
    TO nabuuma_auth_owner
    USING (true);

GRANT USAGE ON SCHEMA nabuuma TO nabuuma_runtime;

CREATE FUNCTION nabuuma.resolve_external_identity(
    p_provider TEXT,
    p_external_subject TEXT,
    p_requested_organisation_id UUID DEFAULT NULL
)
RETURNS TABLE (
    user_id UUID,
    organisation_id UUID,
    role nabuuma.actor_role
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
    SELECT identity.user_id,
           membership.organisation_id,
           membership.role
      FROM nabuuma.external_identities AS identity
      JOIN nabuuma.organisation_memberships AS membership
        ON membership.user_id = identity.user_id
       AND membership.is_active
     WHERE identity.provider = p_provider
       AND identity.external_subject = p_external_subject
       AND (
           p_requested_organisation_id IS NULL
           OR membership.organisation_id = p_requested_organisation_id
       )
       AND (
           p_requested_organisation_id IS NOT NULL
           OR (
               SELECT count(*)
                 FROM nabuuma.organisation_memberships AS active_membership
                WHERE active_membership.user_id = identity.user_id
                  AND active_membership.is_active
           ) = 1
       );
$function$;

ALTER FUNCTION nabuuma.resolve_external_identity(TEXT,TEXT,UUID)
    OWNER TO nabuuma_auth_owner;

REVOKE ALL
ON FUNCTION nabuuma.resolve_external_identity(TEXT,TEXT,UUID)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION nabuuma.resolve_external_identity(TEXT,TEXT,UUID)
TO nabuuma_runtime;

DO $postconditions$
DECLARE
    function_owner text;
    function_security_definer boolean;
    function_config text[];
BEGIN
    SELECT pg_catalog.pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
      INTO STRICT function_owner, function_security_definer, function_config
      FROM pg_catalog.pg_proc p
     WHERE p.oid = 'nabuuma.resolve_external_identity(text,text,uuid)'::regprocedure;

    IF function_owner IS DISTINCT FROM 'nabuuma_auth_owner'
       OR NOT function_security_definer
       OR function_config IS NULL
       OR NOT ('search_path=pg_catalog' = ANY(function_config)) THEN
        RAISE EXCEPTION 'External identity resolver ownership or hardening is incorrect';
    END IF;

    IF pg_catalog.has_table_privilege('nabuuma_runtime','nabuuma.external_identities','SELECT')
       OR pg_catalog.has_table_privilege('nabuuma_runtime','nabuuma.organisation_memberships','SELECT') THEN
        RAISE EXCEPTION 'Runtime must not have direct identity or membership SELECT';
    END IF;

    IF NOT pg_catalog.has_function_privilege(
        'nabuuma_runtime','nabuuma.resolve_external_identity(text,text,uuid)','EXECUTE'
    ) THEN
        RAISE EXCEPTION 'Runtime lacks external identity resolver EXECUTE';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_catalog.aclexplode(
            COALESCE(
                (SELECT p.proacl FROM pg_catalog.pg_proc p
                 WHERE p.oid='nabuuma.resolve_external_identity(text,text,uuid)'::regprocedure),
                pg_catalog.acldefault('f', function_owner::regrole)
            )
        ) acl
        WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'PUBLIC must not have resolver EXECUTE';
    END IF;
END
$postconditions$;

COMMIT;
