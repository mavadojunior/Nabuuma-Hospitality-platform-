-- Run only as an authorised administrator in a NEW disposable restore cluster.
--
-- A PostgreSQL logical database archive does not include cluster-global roles.
-- These roles must exist before pg_restore can recreate object ownership and
-- ACLs recorded in the archive.
--
-- This file intentionally contains no passwords or password hashes.
--
-- This is NOT the clean-migration bootstrap. For canonical migration replay,
-- use scripts/bootstrap-postgres-roles.sql instead.

DO $restore_roles$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_roles
        WHERE rolname = 'nabuuma_app'
    ) THEN
        CREATE ROLE nabuuma_app
            NOLOGIN
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE
            NOINHERIT
            NOREPLICATION
            NOBYPASSRLS;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_roles
        WHERE rolname = 'nabuuma_auth_owner'
    ) THEN
        CREATE ROLE nabuuma_auth_owner
            NOLOGIN
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE
            NOINHERIT
            NOREPLICATION
            NOBYPASSRLS;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_roles
        WHERE rolname = 'nabuuma_certificate_revoke_owner'
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
            NOREPLICATION
            NOBYPASSRLS;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_roles
        WHERE rolname = 'nabuuma_runtime'
    ) THEN
        CREATE ROLE nabuuma_runtime
            LOGIN
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE
            NOINHERIT
            NOREPLICATION
            NOBYPASSRLS;
    END IF;
END
$restore_roles$;

ALTER ROLE nabuuma_app
    NOLOGIN
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE
    NOINHERIT
    NOREPLICATION
    NOBYPASSRLS;

ALTER ROLE nabuuma_auth_owner
    NOLOGIN
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE
    NOINHERIT
    NOREPLICATION
    NOBYPASSRLS;

ALTER ROLE nabuuma_certificate_revoke_owner
    NOLOGIN
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE
    NOINHERIT
    NOREPLICATION
    NOBYPASSRLS;

ALTER ROLE nabuuma_certificate_verifier
    NOLOGIN
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE
    NOINHERIT
    NOREPLICATION
    NOBYPASSRLS;

-- LOGIN is required to reproduce the source role contract. No credential is
-- assigned here. Restore security canaries may use SET ROLE from the authorised
-- disposable-cluster administrator.
ALTER ROLE nabuuma_runtime
    LOGIN
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE
    NOINHERIT
    NOREPLICATION
    NOBYPASSRLS;

-- Reconcile the one canonical membership explicitly.
REVOKE nabuuma_app
    FROM nabuuma_runtime;

GRANT nabuuma_app
    TO nabuuma_runtime
    WITH INHERIT FALSE, SET TRUE;

DO $verification$
DECLARE
    unsafe_role_count integer;
    runtime_login boolean;
    membership_count integer;
BEGIN
    SELECT count(*)
    INTO unsafe_role_count
    FROM pg_catalog.pg_roles
    WHERE rolname IN (
        'nabuuma_app',
        'nabuuma_auth_owner',
        'nabuuma_certificate_revoke_owner',
        'nabuuma_certificate_verifier',
        'nabuuma_runtime'
    )
      AND (
          rolsuper
          OR rolinherit
          OR rolcreaterole
          OR rolcreatedb
          OR rolreplication
          OR rolbypassrls
      );

    IF unsafe_role_count <> 0 THEN
        RAISE EXCEPTION
            'Restore role bootstrap produced unsafe role attributes';
    END IF;

    IF (
        SELECT count(*)
        FROM pg_catalog.pg_roles
        WHERE rolname IN (
            'nabuuma_app',
            'nabuuma_auth_owner',
            'nabuuma_certificate_revoke_owner',
            'nabuuma_certificate_verifier',
            'nabuuma_runtime'
        )
    ) <> 5 THEN
        RAISE EXCEPTION
            'Restore role bootstrap did not create the complete role set';
    END IF;

    SELECT rolcanlogin
    INTO STRICT runtime_login
    FROM pg_catalog.pg_roles
    WHERE rolname = 'nabuuma_runtime';

    IF NOT runtime_login THEN
        RAISE EXCEPTION
            'Restore runtime role must reproduce the LOGIN attribute';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_roles
        WHERE rolname IN (
            'nabuuma_app',
            'nabuuma_auth_owner',
            'nabuuma_certificate_revoke_owner',
            'nabuuma_certificate_verifier'
        )
          AND rolcanlogin
    ) THEN
        RAISE EXCEPTION
            'Restore owner/application roles must remain NOLOGIN';
    END IF;

    SELECT count(*)
    INTO membership_count
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS granted_role
      ON granted_role.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS member_role
      ON member_role.oid = membership.member
    WHERE member_role.rolname = 'nabuuma_runtime'
      AND granted_role.rolname = 'nabuuma_app'
      AND NOT membership.admin_option
      AND NOT membership.inherit_option
      AND membership.set_option;

    IF membership_count <> 1 THEN
        RAISE EXCEPTION
            'Restore runtime-to-application membership is incorrect';
    END IF;
END
$verification$;
