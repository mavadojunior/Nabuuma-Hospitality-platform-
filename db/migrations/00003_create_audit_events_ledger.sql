
-- ============================================================================
-- Nabuuma Hospitality Platform
-- Migration: 00003_create_audit_events_ledger.sql
--
-- Purpose:
--   1. Create an append-only, time-partitioned audit ledger.
--   2. Enforce immutable records using a database trigger.
--   3. Restrict the application role to SELECT and INSERT.
--   4. Provision monthly partitions and grant permissions explicitly.
--
-- Preconditions:
--   - Schema nabuuma already exists.
--   - nabuuma.organisations(id) and nabuuma.users(id) exist and are UUIDs.
--   - Role nabuuma_app_role exists.
--   - The migration runs as a role authorised to create tables, functions,
--     triggers, partitions, foreign keys, and grants.
--
-- Design:
--   - Range partitioning on occurred_at.
--   - Composite primary key (id, occurred_at), required by PostgreSQL
--     for uniqueness on a table partitioned by occurred_at.
--   - 24 monthly partitions, from the current month onward.
--   - No default partition: missing partition coverage fails closed.
--
-- IMPORTANT:
--   The application role must not own this table or its partitions.
--   Provision future partitions before the end of the prepared horizon.
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- 1. Audit ledger
-- --------------------------------------------------------------------------

CREATE TABLE nabuuma.audit_events (
    id              UUID        NOT NULL,
    organisation_id UUID        NOT NULL,
    actor_user_id   UUID        NOT NULL,
    action          VARCHAR(100) NOT NULL,
    entity_type     VARCHAR(50)  NOT NULL,
    entity_id       UUID        NOT NULL,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    correlation_id  UUID        NOT NULL,
    outcome         VARCHAR(20) NOT NULL,
    metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,

    CONSTRAINT audit_events_pkey
        PRIMARY KEY (id, occurred_at),

    CONSTRAINT audit_events_organisation_fk
        FOREIGN KEY (organisation_id)
        REFERENCES nabuuma.organisations (id)
        ON DELETE RESTRICT,

    CONSTRAINT audit_events_actor_user_fk
        FOREIGN KEY (actor_user_id)
        REFERENCES nabuuma.users (id)
        ON DELETE RESTRICT,

    CONSTRAINT audit_events_outcome_check
        CHECK (outcome IN ('SUCCESS', 'FAILURE')),

    CONSTRAINT audit_events_action_nonempty_check
        CHECK (length(btrim(action)) > 0),

    CONSTRAINT audit_events_entity_type_nonempty_check
        CHECK (length(btrim(entity_type)) > 0),

    CONSTRAINT audit_events_metadata_object_check
        CHECK (jsonb_typeof(metadata) = 'object')
)
PARTITION BY RANGE (occurred_at);

COMMENT ON TABLE nabuuma.audit_events IS
    'Append-only, tenant-attributed application audit ledger.';

COMMENT ON COLUMN nabuuma.audit_events.id IS
    'UUID event identifier. The partitioned primary key also includes occurred_at.';

COMMENT ON COLUMN nabuuma.audit_events.correlation_id IS
    'Trusted request or workflow correlation UUID shared across related operations.';

COMMENT ON COLUMN nabuuma.audit_events.metadata IS
    'Structured, non-sensitive audit metadata. Never store credentials or secrets.';

-- --------------------------------------------------------------------------
-- 2. Supporting indexes
--    Partitioned indexes created on the parent are propagated to partitions.
-- --------------------------------------------------------------------------

CREATE INDEX audit_events_org_time_idx
    ON nabuuma.audit_events (organisation_id, occurred_at DESC);

CREATE INDEX audit_events_actor_time_idx
    ON nabuuma.audit_events (actor_user_id, occurred_at DESC);

CREATE INDEX audit_events_entity_time_idx
    ON nabuuma.audit_events (entity_type, entity_id, occurred_at DESC);

CREATE INDEX audit_events_correlation_idx
    ON nabuuma.audit_events (correlation_id);

-- A BRIN index is useful for large, time-correlated append-heavy partitions.
CREATE INDEX audit_events_occurred_at_brin_idx
    ON nabuuma.audit_events
    USING BRIN (occurred_at)
    WITH (pages_per_range = 64);

-- --------------------------------------------------------------------------
-- 3. Strict immutability trigger
--
--    P0001 is PostgreSQL's raise_exception SQLSTATE.
--    UPDATE and DELETE are rejected even if attempted by a role with table
--    UPDATE/DELETE grants. The application role receives neither privilege.
-- --------------------------------------------------------------------------

CREATE FUNCTION nabuuma.reject_audit_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
    RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'nabuuma.audit_events is append-only; UPDATE and DELETE are prohibited',
        DETAIL = format(
            'Rejected %s operation on audit event %s.',
            TG_OP,
            OLD.id
        );
END;
$function$;

COMMENT ON FUNCTION nabuuma.reject_audit_event_mutation() IS
    'Rejects UPDATE and DELETE attempts against the immutable audit ledger.';

CREATE TRIGGER trg_audit_events_immutable
    BEFORE UPDATE OR DELETE
    ON nabuuma.audit_events
    FOR EACH ROW
    EXECUTE FUNCTION nabuuma.reject_audit_event_mutation();

-- --------------------------------------------------------------------------
-- 4. Provision 24 monthly partitions
--
--    The loop creates the current month and the following 23 months.
--    Each partition receives explicit application privileges.
--    The parent trigger is cloned to each partition by PostgreSQL.
-- --------------------------------------------------------------------------

DO $partition_setup$
DECLARE
    v_month_start DATE;
    v_month_end   DATE;
    v_partition   TEXT;
    v_month       INTEGER;
BEGIN
    v_month_start := date_trunc('month', CURRENT_DATE)::DATE;

    FOR v_month IN 0..23 LOOP
        v_month_start :=
            (date_trunc('month', CURRENT_DATE)
                + make_interval(months => v_month))::DATE;

        v_month_end :=
            (date_trunc('month', CURRENT_DATE)
                + make_interval(months => v_month + 1))::DATE;

        v_partition := format(
            'audit_events_%s',
            to_char(v_month_start, 'YYYY_MM')
        );

        EXECUTE format(
            'CREATE TABLE nabuuma.%I PARTITION OF nabuuma.audit_events
             FOR VALUES FROM (%L) TO (%L)',
            v_partition,
            v_month_start,
            v_month_end
        );

        -- Revoke ambient/default access before granting least privilege.
        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON TABLE nabuuma.%I FROM PUBLIC',
            v_partition
        );

        EXECUTE format(
            'REVOKE ALL PRIVILEGES ON TABLE nabuuma.%I FROM nabuuma_app_role',
            v_partition
        );

        EXECUTE format(
            'GRANT SELECT, INSERT ON TABLE nabuuma.%I TO nabuuma_app_role',
            v_partition
        );
    END LOOP;
END;
$partition_setup$;

-- --------------------------------------------------------------------------
-- 5. Least-privilege grants on the partitioned parent
--
--    Revoke all existing privileges from PUBLIC and the application role,
--    then grant only SELECT and INSERT.
-- --------------------------------------------------------------------------

REVOKE ALL PRIVILEGES ON TABLE nabuuma.audit_events FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE nabuuma.audit_events FROM nabuuma_app_role;

GRANT SELECT, INSERT
    ON TABLE nabuuma.audit_events
    TO nabuuma_app_role;

-- The application role must not be able to replace the trigger function.
REVOKE ALL PRIVILEGES
    ON FUNCTION nabuuma.reject_audit_event_mutation()
    FROM PUBLIC;

REVOKE ALL PRIVILEGES
    ON FUNCTION nabuuma.reject_audit_event_mutation()
    FROM nabuuma_app_role;

-- --------------------------------------------------------------------------
-- 6. Migration-time integrity assertions
-- --------------------------------------------------------------------------

DO $assertions$
DECLARE
    v_parent_kind "char";
    v_partition_key TEXT;
    v_trigger_count INTEGER;
BEGIN
    SELECT c.relkind
      INTO v_parent_kind
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'nabuuma'
       AND c.relname = 'audit_events';

    IF v_parent_kind IS DISTINCT FROM 'p' THEN
        RAISE EXCEPTION
            'Audit ledger assertion failed: nabuuma.audit_events is not partitioned';
    END IF;

    SELECT pg_get_partkeydef(c.oid)
      INTO v_partition_key
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'nabuuma'
       AND c.relname = 'audit_events';

    IF v_partition_key IS DISTINCT FROM 'RANGE (occurred_at)' THEN
        RAISE EXCEPTION
            'Audit ledger assertion failed: unexpected partition key: %',
            v_partition_key;
    END IF;

    SELECT count(*)
      INTO v_trigger_count
      FROM pg_trigger t
     WHERE t.tgrelid = 'nabuuma.audit_events'::regclass
       AND t.tgname = 'trg_audit_events_immutable'
       AND NOT t.tgisinternal
       AND t.tgenabled <> 'D';

    IF v_trigger_count <> 1 THEN
        RAISE EXCEPTION
            'Audit ledger assertion failed: immutable trigger missing or disabled';
    END IF;

    IF has_table_privilege(
        'nabuuma_app_role',
        'nabuuma.audit_events',
        'UPDATE'
    ) OR has_table_privilege(
        'nabuuma_app_role',
        'nabuuma.audit_events',
        'DELETE'
    ) OR has_table_privilege(
        'nabuuma_app_role',
        'nabuuma.audit_events',
        'TRUNCATE'
    ) THEN
        RAISE EXCEPTION
            'Audit ledger assertion failed: application role has mutation privileges';
    END IF;

    IF NOT has_table_privilege(
        'nabuuma_app_role',
        'nabuuma.audit_events',
        'INSERT'
    ) OR NOT has_table_privilege(
        'nabuuma_app_role',
        'nabuuma.audit_events',
        'SELECT'
    ) THEN
        RAISE EXCEPTION
            'Audit ledger assertion failed: required application privileges missing';
    END IF;
END;
$assertions$;

COMMIT;

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================

