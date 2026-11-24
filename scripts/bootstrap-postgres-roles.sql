-- Run only as an authorised administrator in a NEW recovery cluster.
--
-- This bootstrap creates only the cluster-global runtime prerequisite that
-- canonical migrations expect to exist before migration execution.
--
-- Migration-owned roles are deliberately NOT created here:
--   nabuuma_app                         -> migration 00002
--   nabuuma_certificate_verifier        -> migration 00009
--   nabuuma_auth_owner                  -> migration 00014
--   nabuuma_certificate_revoke_owner    -> migration 00019
--
-- The runtime role remains NOLOGIN here. Disposable release certification
-- converts it to a constrained LOGIN only after canonical migrations complete.

DO $roles$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_roles
        WHERE rolname = 'nabuuma_runtime'
    ) THEN
        CREATE ROLE nabuuma_runtime
            NOLOGIN
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE
            NOINHERIT
            NOREPLICATION
            NOBYPASSRLS;
    END IF;
END
$roles$;

ALTER ROLE nabuuma_runtime
    NOLOGIN
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE
    NOINHERIT
    NOREPLICATION
    NOBYPASSRLS;
