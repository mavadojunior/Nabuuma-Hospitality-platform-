BEGIN;

-- ============================================================================
-- NABUUMA HOSPITALITY PLATFORM
-- Migration 00005: Append-only audit event ledger
--
-- Prerequisites:
--   - Migrations 00001 through 00004 have been applied in the intended order.
--   - The nabuuma_app NOLOGIN role exists.
--   - Identity helpers and membership checks exist.
--
-- Security:
--   - Tenant-scoped SELECT and INSERT policies.
--   - The actor must match the transaction-local application identity.
--   - The application role receives no UPDATE, DELETE, TRUNCATE, or DDL rights.
--   - Partitions are not granted directly to the application role.
--   - This migration does not configure production login-role membership.
-- ============================================================================

-- 1. Fail early if the existing security foundation is missing.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_roles WHERE rolname = 'nabuuma_app'
    ) THEN
        RAISE EXCEPTION
            'Required role nabuuma_app does not exist';
    END IF;

    IF to_regprocedure('nabuuma.current_app_user_id()') IS NULL THEN
        RAISE EXCEPTION
            'Required helper nabuuma.current_app_user_id() does not exist';
    END IF;

    IF to_regprocedure('nabuuma.current_app_organisation_id()') IS NULL THEN
        RAISE EXCEPTION
            'Required helper nabuuma.current_app_organisation_id() does not exist';
    END IF;

    IF to_regprocedure('nabuuma.is_active_member(uuid,uuid)') IS NULL THEN
        RAISE EXCEPTION
            'Required helper nabuuma.is_active_member(uuid,uuid) does not exist';
    END IF;
END
$$;

GRANT USAGE ON SCHEMA nabuuma TO nabuuma_app;

GRANT EXECUTE
ON FUNCTION nabuuma.current_app_user_id()
TO nabuuma_app;

GRANT EXECUTE
ON FUNCTION nabuuma.current_app_organisation_id()
TO nabuuma_app;

GRANT EXECUTE
ON FUNCTION nabuuma.is_active_member(UUID, UUID)
TO nabuuma_app;

-- 2. Create the partitioned audit ledger.
CREATE TABLE nabuuma.audit_events (
    id UUID NOT NULL,
    organisation_id UUID NOT NULL,
    actor_user_id UUID NOT NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    correlation_id UUID NOT NULL,
    outcome VARCHAR(20) NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    CONSTRAINT audit_events_pk
        PRIMARY KEY (id, occurred_at),

    CONSTRAINT audit_events_organisation_fk
        FOREIGN KEY (organisation_id)
        REFERENCES nabuuma.organisations(id)
        ON DELETE RESTRICT,

    CONSTRAINT audit_events_actor_fk
        FOREIGN KEY (actor_user_id)
        REFERENCES nabuuma.users(id)
        ON DELETE RESTRICT,

    CONSTRAINT audit_events_action_nonempty
        CHECK (length(btrim(action)) > 0),

    CONSTRAINT audit_events_entity_type_nonempty
        CHECK (length(btrim(entity_type)) > 0),

    CONSTRAINT audit_events_outcome_valid
        CHECK (outcome IN ('SUCCESS', 'FAILURE')),

    CONSTRAINT audit_events_metadata_object
        CHECK (jsonb_typeof(metadata) = 'object')
)
PARTITION BY RANGE (occurred_at);

-- 3. Create 24 monthly partitions using explicit UTC boundaries.
-- No DEFAULT partition is created: missing future partitions fail closed.
DO $$
DECLARE
    v_month INTEGER;
    v_month_start TIMESTAMPTZ;
    v_month_end TIMESTAMPTZ;
    v_partition_name TEXT;
    v_start_bound TEXT;
    v_end_bound TEXT;
BEGIN
    FOR v_month IN 0..23 LOOP
        v_month_start :=
            (
                date_trunc(
                    'month',
                    CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
                ) + make_interval(months => v_month)
            ) AT TIME ZONE 'UTC';

        v_month_end :=
            (
                date_trunc(
                    'month',
                    CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
                ) + make_interval(months => v_month + 1)
            ) AT TIME ZONE 'UTC';

        v_partition_name :=
            'audit_events_' ||
            to_char(v_month_start AT TIME ZONE 'UTC', 'YYYY_MM');

        -- Make the UTC offset explicit rather than relying on session timezone.
        v_start_bound :=
            to_char(
                v_month_start AT TIME ZONE 'UTC',
                'YYYY-MM-DD HH24:MI:SS'
            ) || '+00';

        v_end_bound :=
            to_char(
                v_month_end AT TIME ZONE 'UTC',
                'YYYY-MM-DD HH24:MI:SS'
            ) || '+00';

        EXECUTE format(
            'CREATE TABLE nabuuma.%I
             PARTITION OF nabuuma.audit_events
             FOR VALUES FROM (%L) TO (%L)',
            v_partition_name,
            v_start_bound,
            v_end_bound
        );

        -- Prevent direct access to individual audit partitions.
        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON TABLE nabuuma.%I FROM PUBLIC',
            v_partition_name
        );

        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON TABLE nabuuma.%I FROM nabuuma_app',
            v_partition_name
        );
    END LOOP;
END
$$;

-- 4. Add parent-level indexes; PostgreSQL creates corresponding partition indexes.
CREATE INDEX audit_events_org_time_idx
    ON nabuuma.audit_events (organisation_id, occurred_at DESC);

CREATE INDEX audit_events_actor_time_idx
    ON nabuuma.audit_events (actor_user_id, occurred_at DESC);

CREATE INDEX audit_events_entity_time_idx
    ON nabuuma.audit_events (entity_type, entity_id, occurred_at DESC);

CREATE INDEX audit_events_correlation_idx
    ON nabuuma.audit_events (correlation_id);

CREATE INDEX audit_events_occurred_at_brin_idx
    ON nabuuma.audit_events
    USING BRIN (occurred_at)
    WITH (pages_per_range = 64);

-- 5. Reject row-level mutation as defense in depth.
CREATE OR REPLACE FUNCTION nabuuma.reject_audit_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
    RAISE EXCEPTION
        USING
            ERRCODE = '55000',
            MESSAGE = 'Audit events are append-only; UPDATE and DELETE are prohibited';
END;
$function$;

REVOKE ALL
ON FUNCTION nabuuma.reject_audit_event_mutation()
FROM PUBLIC;

CREATE TRIGGER trg_audit_events_immutable
BEFORE UPDATE OR DELETE
ON nabuuma.audit_events
FOR EACH ROW
EXECUTE FUNCTION nabuuma.reject_audit_event_mutation();

-- 6. Enforce row-level security on the parent.
ALTER TABLE nabuuma.audit_events
    ENABLE ROW LEVEL SECURITY;

ALTER TABLE nabuuma.audit_events
    FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_events_tenant_select
ON nabuuma.audit_events
FOR SELECT
TO nabuuma_app
USING (
    organisation_id = nabuuma.current_app_organisation_id()
    AND nabuuma.current_app_user_id() IS NOT NULL
    AND nabuuma.is_active_member(
        organisation_id,
        nabuuma.current_app_user_id()
    )
);

CREATE POLICY audit_events_tenant_insert
ON nabuuma.audit_events
FOR INSERT
TO nabuuma_app
WITH CHECK (
    organisation_id = nabuuma.current_app_organisation_id()
    AND actor_user_id = nabuuma.current_app_user_id()
    AND nabuuma.current_app_user_id() IS NOT NULL
    AND nabuuma.is_active_member(
        organisation_id,
        nabuuma.current_app_user_id()
    )
);

-- 7. Grant only parent-table read and append privileges.
-- Do not grant direct privileges on child partitions.
REVOKE ALL PRIVILEGES
ON TABLE nabuuma.audit_events
FROM PUBLIC;

REVOKE ALL PRIVILEGES
ON TABLE nabuuma.audit_events
FROM nabuuma_app;

GRANT SELECT, INSERT
ON TABLE nabuuma.audit_events
TO nabuuma_app;

-- 8. Validate the security-critical invariants before committing.
DO $$
DECLARE
    v_parent_oid OID;
    v_partition_count INTEGER;
    v_policy_count INTEGER;
BEGIN
    SELECT c.oid
    INTO v_parent_oid
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'nabuuma'
      AND c.relname = 'audit_events'
      AND c.relkind = 'p';

    IF v_parent_oid IS NULL THEN
        RAISE EXCEPTION
            'Audit ledger is not a partitioned table';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_class
        WHERE oid = v_parent_oid
          AND relrowsecurity
          AND relforcerowsecurity
    ) THEN
        RAISE EXCEPTION
            'Audit ledger RLS is not enabled and forced';
    END IF;

    SELECT count(*)
    INTO v_partition_count
    FROM pg_inherits
    WHERE inhparent = v_parent_oid;

    IF v_partition_count <> 24 THEN
        RAISE EXCEPTION
            'Expected 24 audit partitions; found %',
            v_partition_count;
    END IF;

    SELECT count(*)
    INTO v_policy_count
    FROM pg_policies
    WHERE schemaname = 'nabuuma'
      AND tablename = 'audit_events'
      AND policyname IN (
          'audit_events_tenant_select',
          'audit_events_tenant_insert'
      );

    IF v_policy_count <> 2 THEN
        RAISE EXCEPTION
            'Expected both tenant-scoped audit policies';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgrelid = v_parent_oid
          AND tgname = 'trg_audit_events_immutable'
          AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION
            'Audit immutability trigger is missing';
    END IF;

    IF NOT has_table_privilege(
        'nabuuma_app', 'nabuuma.audit_events', 'SELECT'
    ) OR NOT has_table_privilege(
        'nabuuma_app', 'nabuuma.audit_events', 'INSERT'
    ) THEN
        RAISE EXCEPTION
            'Application role lacks required audit privileges';
    END IF;

    IF has_table_privilege(
        'nabuuma_app', 'nabuuma.audit_events', 'UPDATE'
    ) OR has_table_privilege(
        'nabuuma_app', 'nabuuma.audit_events', 'DELETE'
    ) OR has_table_privilege(
        'nabuuma_app', 'nabuuma.audit_events', 'TRUNCATE'
    ) THEN
        RAISE EXCEPTION
            'Application role has a prohibited audit privilege';
    END IF;
END
$$;

COMMENT ON TABLE nabuuma.audit_events IS
    'Append-only, tenant-scoped audit events. Partition maintenance and privileged administrative operations require separate controls.';

COMMENT ON COLUMN nabuuma.audit_events.correlation_id IS
    'Identifier connecting audit events to the same application operation or request.';

COMMIT;
