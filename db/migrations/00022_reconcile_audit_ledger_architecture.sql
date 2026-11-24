BEGIN;

SET LOCAL search_path = pg_catalog;

CREATE OR REPLACE FUNCTION nabuuma.reject_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
    RAISE EXCEPTION 'audit ledger is append-only'
        USING ERRCODE = '55000';
END;
$function$;
REVOKE ALL ON FUNCTION nabuuma.reject_audit_event_mutation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nabuuma.reject_audit_event_mutation() TO nabuuma_app;

CREATE OR REPLACE FUNCTION nabuuma.resolve_certificate_id_for_revocation(p_certificate_number TEXT)
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
    SELECT certificate.id
      FROM nabuuma.academy_certificates certificate
     WHERE certificate.organisation_id = nabuuma.current_app_organisation_id()
       AND certificate.certificate_number = p_certificate_number
     LIMIT 1
$function$;
ALTER FUNCTION nabuuma.resolve_certificate_id_for_revocation(TEXT)
OWNER TO nabuuma_certificate_revoke_owner;
REVOKE ALL ON FUNCTION nabuuma.resolve_certificate_id_for_revocation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nabuuma.resolve_certificate_id_for_revocation(TEXT) TO nabuuma_app;

DO $audit_reconcile$
DECLARE
    relation_kind "char";
    partition_key TEXT;
    default_partition_oid OID;
    invalid_rows BIGINT;
    inbound_fk_count BIGINT;
    month_start DATE;
    month_end DATE;
    partition_name TEXT;
    primary_key_columns TEXT[];
    id_default TEXT;
    unexpected_policy_count BIGINT;
    unexpected_trigger_count BIGINT;
    canonical_fk_count BIGINT;
BEGIN
    SELECT c.relkind
      INTO relation_kind
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'nabuuma'
       AND c.relname = 'audit_events';

    IF relation_kind IS NULL THEN
        RAISE EXCEPTION 'AUDIT_00022: nabuuma.audit_events is missing';
    END IF;

    IF relation_kind = 'p' THEN
        -- Reconcile in place: valid evolved partition OIDs and historical rows
        -- no rebuild of valid evolved history: valid partition OIDs and rows
        -- are not rewritten merely to converge on the catalogue.
        SELECT pg_get_partkeydef(c.oid)
          INTO partition_key
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'nabuuma'
           AND c.relname = 'audit_events';

        IF partition_key <> 'RANGE (occurred_at)' THEN
            RAISE EXCEPTION 'AUDIT_00022: evolved partition key is %, expected RANGE (occurred_at)', partition_key;
        END IF;

        SELECT array_agg(attribute.attname ORDER BY key_column.ordinality)
          INTO primary_key_columns
          FROM pg_constraint constraint_catalog
          JOIN unnest(constraint_catalog.conkey) WITH ORDINALITY AS key_column(attnum, ordinality) ON true
          JOIN pg_attribute attribute
            ON attribute.attrelid = constraint_catalog.conrelid
           AND attribute.attnum = key_column.attnum
         WHERE constraint_catalog.conrelid = 'nabuuma.audit_events'::regclass
           AND constraint_catalog.contype = 'p';
        IF primary_key_columns IS DISTINCT FROM ARRAY['id','occurred_at']::TEXT[] THEN
            RAISE EXCEPTION 'AUDIT_00022: evolved primary key is %, expected (id, occurred_at)', primary_key_columns;
        END IF;

        SELECT pg_get_expr(default_catalog.adbin, default_catalog.adrelid)
          INTO id_default
          FROM pg_attrdef default_catalog
          JOIN pg_attribute attribute
            ON attribute.attrelid = default_catalog.adrelid
           AND attribute.attnum = default_catalog.adnum
         WHERE default_catalog.adrelid = 'nabuuma.audit_events'::regclass
           AND attribute.attname = 'id';
        IF id_default IS NULL OR id_default NOT LIKE '%gen_random_uuid%' THEN
            RAISE EXCEPTION 'AUDIT_00022: evolved id default is %, expected gen_random_uuid()', id_default;
        END IF;

        IF EXISTS (
            SELECT 1 FROM pg_attribute
             WHERE attrelid = 'nabuuma.audit_events'::regclass
               AND attname = 'correlation_id'
               AND attnotnull
        ) OR NOT EXISTS (
            SELECT 1 FROM pg_attribute
             WHERE attrelid = 'nabuuma.audit_events'::regclass
               AND attname = 'entity_id'
               AND attnotnull
        ) OR NOT EXISTS (
            SELECT 1 FROM pg_attribute
             WHERE attrelid = 'nabuuma.audit_events'::regclass
               AND attname = 'outcome'
               AND attnotnull
        ) THEN
            RAISE EXCEPTION 'AUDIT_00022: evolved nullability does not match canonical audit contract';
        END IF;

        SELECT count(*)
          INTO canonical_fk_count
          FROM pg_constraint
         WHERE conrelid = 'nabuuma.audit_events'::regclass
           AND contype = 'f'
           AND confdeltype = 'r'
           AND ((conname = 'audit_events_actor_fk' AND confrelid = 'nabuuma.users'::regclass)
             OR (conname = 'audit_events_organisation_fk' AND confrelid = 'nabuuma.organisations'::regclass));
        IF canonical_fk_count <> 2 THEN
            RAISE EXCEPTION 'AUDIT_00022: evolved ledger FK actions/names do not match canonical RESTRICT contract';
        END IF;

        SELECT count(*)
          INTO unexpected_policy_count
          FROM pg_policies
         WHERE schemaname = 'nabuuma'
           AND tablename = 'audit_events'
           AND policyname NOT IN ('audit_events_tenant_select','audit_events_tenant_insert','tenant_audit_events_select','tenant_audit_events_insert');
        IF unexpected_policy_count <> 0 THEN
            RAISE EXCEPTION 'AUDIT_00022: evolved ledger contains % unexpected policies', unexpected_policy_count;
        END IF;

        SELECT count(*)
          INTO unexpected_trigger_count
          FROM pg_trigger
         WHERE tgrelid = 'nabuuma.audit_events'::regclass
           AND NOT tgisinternal
           AND tgname <> 'trg_audit_events_immutable';
        IF unexpected_trigger_count <> 0 THEN
            RAISE EXCEPTION 'AUDIT_00022: evolved ledger contains % unexpected triggers', unexpected_trigger_count;
        END IF;

        SELECT count(*)
          INTO invalid_rows
          FROM nabuuma.audit_events
         WHERE id IS NULL
            OR organisation_id IS NULL
            OR actor_user_id IS NULL
            OR action IS NULL
            OR length(action) > 100
            OR entity_type IS NULL
            OR length(entity_type) > 50
            OR entity_id IS NULL
            OR occurred_at IS NULL
            OR outcome IS NULL
            OR length(outcome) > 20
            OR outcome NOT IN ('SUCCESS','FAILURE')
            OR metadata IS NULL
            OR jsonb_typeof(metadata) <> 'object';
        IF invalid_rows <> 0 THEN
            RAISE EXCEPTION 'AUDIT_00022: evolved ledger contains % rows incompatible with canonical constraints', invalid_rows;
        END IF;

        SELECT count(*)
          INTO inbound_fk_count
          FROM pg_constraint
         WHERE contype = 'f'
           AND confrelid = 'nabuuma.audit_events'::regclass
           AND conrelid <> 'nabuuma.audit_events'::regclass;
        IF inbound_fk_count <> 0 THEN
            RAISE EXCEPTION 'AUDIT_00022: evolved ledger has % inbound foreign keys requiring explicit reconciliation', inbound_fk_count;
        END IF;

        SELECT inheritance.inhrelid
          INTO default_partition_oid
          FROM pg_inherits inheritance
          JOIN pg_class child ON child.oid = inheritance.inhrelid
         WHERE inheritance.inhparent = 'nabuuma.audit_events'::regclass
           AND pg_get_expr(child.relpartbound, child.oid) = 'DEFAULT';

        IF default_partition_oid IS NULL THEN
            EXECUTE 'CREATE TABLE nabuuma.audit_events_default PARTITION OF nabuuma.audit_events DEFAULT';
        END IF;

    ELSIF relation_kind = 'r' THEN
        LOCK TABLE nabuuma.audit_events IN ACCESS EXCLUSIVE MODE;

        SELECT count(*)
          INTO invalid_rows
          FROM nabuuma.audit_events
         WHERE id IS NULL
            OR organisation_id IS NULL
            OR actor_user_id IS NULL
            OR action IS NULL
            OR length(action) > 100
            OR entity_type IS NULL
            OR length(entity_type) > 50
            OR entity_id IS NULL
            OR occurred_at IS NULL
            OR outcome IS NULL
            OR length(outcome) > 20
            OR outcome NOT IN ('SUCCESS','FAILURE')
            OR metadata IS NULL
            OR jsonb_typeof(metadata) <> 'object';
        IF invalid_rows <> 0 THEN
            RAISE EXCEPTION 'AUDIT_00022: heap contains % rows incompatible with canonical constraints; no values fabricated', invalid_rows;
        END IF;

        SELECT count(*)
          INTO invalid_rows
          FROM nabuuma.audit_events a
          LEFT JOIN nabuuma.organisations o ON o.id = a.organisation_id
          LEFT JOIN nabuuma.users u ON u.id = a.actor_user_id
         WHERE o.id IS NULL OR u.id IS NULL;
        IF invalid_rows <> 0 THEN
            RAISE EXCEPTION 'AUDIT_00022: heap contains % orphaned organisation/actor references', invalid_rows;
        END IF;

        SELECT count(*)
          INTO inbound_fk_count
          FROM pg_constraint
         WHERE contype = 'f'
           AND confrelid = 'nabuuma.audit_events'::regclass
           AND conrelid <> 'nabuuma.audit_events'::regclass;
        IF inbound_fk_count <> 0 THEN
            RAISE EXCEPTION 'AUDIT_00022: heap has % inbound foreign keys requiring explicit reconciliation', inbound_fk_count;
        END IF;

        CREATE TABLE nabuuma.audit_events_reconciled (
            id UUID NOT NULL DEFAULT gen_random_uuid(),
            organisation_id UUID NOT NULL,
            actor_user_id UUID NOT NULL,
            action VARCHAR(100) NOT NULL,
            entity_type VARCHAR(50) NOT NULL,
            entity_id UUID NOT NULL,
            occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            correlation_id UUID,
            outcome VARCHAR(20) NOT NULL,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            CONSTRAINT audit_events_reconciled_pk PRIMARY KEY (id, occurred_at),
            CONSTRAINT audit_events_reconciled_action_nonempty CHECK (length(btrim(action)) > 0),
            CONSTRAINT audit_events_reconciled_entity_type_nonempty CHECK (length(btrim(entity_type)) > 0),
            CONSTRAINT audit_events_reconciled_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
            CONSTRAINT audit_events_reconciled_outcome_valid CHECK (outcome IN ('SUCCESS','FAILURE')),
            CONSTRAINT audit_events_reconciled_actor_fk FOREIGN KEY (actor_user_id) REFERENCES nabuuma.users(id) ON DELETE RESTRICT,
            CONSTRAINT audit_events_reconciled_organisation_fk FOREIGN KEY (organisation_id) REFERENCES nabuuma.organisations(id) ON DELETE RESTRICT
        ) PARTITION BY RANGE (occurred_at);

        month_start := DATE '2026-10-01';
        WHILE month_start < DATE '2028-10-01' LOOP
            month_end := (month_start + INTERVAL '1 month')::date;
            partition_name := 'audit_events_' || to_char(month_start, 'YYYY_MM');
            EXECUTE format(
                'CREATE TABLE nabuuma.%I PARTITION OF nabuuma.audit_events_reconciled FOR VALUES FROM (%L) TO (%L)',
                partition_name,
                (month_start::timestamp AT TIME ZONE 'Asia/Dubai'),
                (month_end::timestamp AT TIME ZONE 'Asia/Dubai')
            );
            month_start := month_end;
        END LOOP;
        CREATE TABLE nabuuma.audit_events_reconciled_default PARTITION OF nabuuma.audit_events_reconciled DEFAULT;

        CREATE INDEX audit_events_reconciled_actor_time_idx ON nabuuma.audit_events_reconciled (actor_user_id, occurred_at DESC);
        CREATE INDEX audit_events_reconciled_correlation_idx ON nabuuma.audit_events_reconciled (correlation_id);
        CREATE INDEX audit_events_reconciled_entity_time_idx ON nabuuma.audit_events_reconciled (entity_type, entity_id, occurred_at DESC);
        CREATE INDEX audit_events_reconciled_occurred_at_brin_idx ON nabuuma.audit_events_reconciled USING brin (occurred_at) WITH (pages_per_range = 64);
        CREATE INDEX audit_events_reconciled_org_time_idx ON nabuuma.audit_events_reconciled (organisation_id, occurred_at DESC);

        ALTER TABLE nabuuma.audit_events_reconciled ENABLE ROW LEVEL SECURITY;
        ALTER TABLE nabuuma.audit_events_reconciled FORCE ROW LEVEL SECURITY;
        CREATE POLICY audit_events_tenant_select ON nabuuma.audit_events_reconciled FOR SELECT TO nabuuma_app USING (
            organisation_id = nabuuma.current_app_organisation_id()
            AND nabuuma.current_app_user_id() IS NOT NULL
            AND nabuuma.is_active_member(organisation_id, nabuuma.current_app_user_id())
        );
        CREATE POLICY audit_events_tenant_insert ON nabuuma.audit_events_reconciled FOR INSERT TO nabuuma_app WITH CHECK (
            organisation_id = nabuuma.current_app_organisation_id()
            AND actor_user_id = nabuuma.current_app_user_id()
            AND nabuuma.current_app_user_id() IS NOT NULL
            AND nabuuma.is_active_member(organisation_id, nabuuma.current_app_user_id())
        );
        GRANT SELECT, INSERT ON nabuuma.audit_events_reconciled TO nabuuma_app;
        CREATE TRIGGER trg_audit_events_immutable BEFORE UPDATE OR DELETE ON nabuuma.audit_events_reconciled FOR EACH ROW EXECUTE FUNCTION nabuuma.reject_audit_event_mutation();

        INSERT INTO nabuuma.audit_events_reconciled (
            id, organisation_id, actor_user_id, action, entity_type, entity_id,
            occurred_at, correlation_id, outcome, metadata
        )
        SELECT
            id, organisation_id, actor_user_id, action, entity_type, entity_id,
            occurred_at, correlation_id, outcome, metadata
        FROM nabuuma.audit_events;

        IF EXISTS (
            SELECT id, organisation_id, actor_user_id, action, entity_type, entity_id,
                   occurred_at, correlation_id, outcome, metadata
            FROM nabuuma.audit_events
            EXCEPT ALL
            SELECT id, organisation_id, actor_user_id, action, entity_type, entity_id,
                   occurred_at, correlation_id, outcome, metadata
            FROM nabuuma.audit_events_reconciled
        ) OR EXISTS (
            SELECT id, organisation_id, actor_user_id, action, entity_type, entity_id,
                   occurred_at, correlation_id, outcome, metadata
            FROM nabuuma.audit_events_reconciled
            EXCEPT ALL
            SELECT id, organisation_id, actor_user_id, action, entity_type, entity_id,
                   occurred_at, correlation_id, outcome, metadata
            FROM nabuuma.audit_events
        ) THEN
            RAISE EXCEPTION 'AUDIT_00022: bidirectional row equality failed; source heap retained';
        END IF;

        ALTER TABLE nabuuma.audit_events RENAME TO audit_events_legacy_00022;
        ALTER TABLE nabuuma.audit_events_reconciled RENAME TO audit_events;

        -- Rename clean-replay child relations and their local indexes to the
        -- canonical names recorded by the evolved catalogue evidence.
        FOR partition_name IN
            SELECT child.relname
              FROM pg_inherits inheritance
              JOIN pg_class parent ON parent.oid = inheritance.inhparent
              JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
              JOIN pg_class child ON child.oid = inheritance.inhrelid
             WHERE parent_ns.nspname = 'nabuuma'
               AND parent.relname = 'audit_events'
               AND child.relname LIKE 'audit_events_reconciled_%'
        LOOP
            DECLARE
                canonical_partition_name TEXT := replace(partition_name, 'audit_events_reconciled_', 'audit_events_');
                index_name TEXT;
            BEGIN
                EXECUTE format('ALTER TABLE nabuuma.%I RENAME TO %I', partition_name, canonical_partition_name);
                FOR index_name IN
                    SELECT index_class.relname
                      FROM pg_index index_catalog
                      JOIN pg_class index_class ON index_class.oid = index_catalog.indexrelid
                      JOIN pg_class table_class ON table_class.oid = index_catalog.indrelid
                      JOIN pg_namespace table_ns ON table_ns.oid = table_class.relnamespace
                     WHERE table_ns.nspname = 'nabuuma'
                       AND table_class.relname = canonical_partition_name
                       AND index_class.relname LIKE partition_name || '_%'
                LOOP
                    EXECUTE format('ALTER INDEX nabuuma.%I RENAME TO %I', index_name, replace(index_name, partition_name, canonical_partition_name));
                END LOOP;
            END;
        END LOOP;

        ALTER INDEX nabuuma.audit_events_reconciled_pk RENAME TO audit_events_pk;
        ALTER INDEX nabuuma.audit_events_reconciled_actor_time_idx RENAME TO audit_events_actor_time_idx;
        ALTER INDEX nabuuma.audit_events_reconciled_correlation_idx RENAME TO audit_events_correlation_idx;
        ALTER INDEX nabuuma.audit_events_reconciled_entity_time_idx RENAME TO audit_events_entity_time_idx;
        ALTER INDEX nabuuma.audit_events_reconciled_occurred_at_brin_idx RENAME TO audit_events_occurred_at_brin_idx;
        ALTER INDEX nabuuma.audit_events_reconciled_org_time_idx RENAME TO audit_events_org_time_idx;
        ALTER TABLE nabuuma.audit_events RENAME CONSTRAINT audit_events_reconciled_actor_fk TO audit_events_actor_fk;
        ALTER TABLE nabuuma.audit_events RENAME CONSTRAINT audit_events_reconciled_organisation_fk TO audit_events_organisation_fk;
        DROP TABLE nabuuma.audit_events_legacy_00022;

    ELSE
        RAISE EXCEPTION 'AUDIT_00022: unsupported audit_events relkind %', relation_kind;
    END IF;

    -- Reconcile canonical parent indexes without rewriting valid partition history.
    CREATE INDEX IF NOT EXISTS audit_events_actor_time_idx ON nabuuma.audit_events (actor_user_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS audit_events_correlation_idx ON nabuuma.audit_events (correlation_id);
    CREATE INDEX IF NOT EXISTS audit_events_entity_time_idx ON nabuuma.audit_events (entity_type, entity_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS audit_events_occurred_at_brin_idx ON nabuuma.audit_events USING brin (occurred_at) WITH (pages_per_range = 64);
    CREATE INDEX IF NOT EXISTS audit_events_org_time_idx ON nabuuma.audit_events (organisation_id, occurred_at DESC);

    ALTER TABLE nabuuma.audit_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE nabuuma.audit_events FORCE ROW LEVEL SECURITY;

    -- Remove legacy policy aliases, but retain canonical policies when their
    -- definitions and role bindings already match. Replacing a valid policy
    -- creates catalogue churn and can invalidate dependent plans unnecessarily.
    DROP POLICY IF EXISTS tenant_audit_events_select ON nabuuma.audit_events;
    DROP POLICY IF EXISTS tenant_audit_events_insert ON nabuuma.audit_events;

    DO $policy_reconcile$
    DECLARE
        select_policy_valid BOOLEAN;
        insert_policy_valid BOOLEAN;
    BEGIN
        SELECT EXISTS (
            SELECT 1 FROM pg_policies
             WHERE schemaname='nabuuma' AND tablename='audit_events'
               AND policyname='audit_events_tenant_select'
               AND cmd='SELECT' AND roles=ARRAY['nabuuma_app']::name[]
               AND qual='((organisation_id = nabuuma.current_app_organisation_id()) AND (nabuuma.current_app_user_id() IS NOT NULL) AND nabuuma.is_active_member(organisation_id, nabuuma.current_app_user_id()))'
               AND with_check IS NULL
        ) INTO select_policy_valid;
        IF NOT select_policy_valid THEN
            DROP POLICY IF EXISTS audit_events_tenant_select ON nabuuma.audit_events;
            CREATE POLICY audit_events_tenant_select ON nabuuma.audit_events FOR SELECT TO nabuuma_app USING (
                organisation_id = nabuuma.current_app_organisation_id()
                AND nabuuma.current_app_user_id() IS NOT NULL
                AND nabuuma.is_active_member(organisation_id, nabuuma.current_app_user_id())
            );
        END IF;

        SELECT EXISTS (
            SELECT 1 FROM pg_policies
             WHERE schemaname='nabuuma' AND tablename='audit_events'
               AND policyname='audit_events_tenant_insert'
               AND cmd='INSERT' AND roles=ARRAY['nabuuma_app']::name[]
               AND qual IS NULL
               AND with_check='((organisation_id = nabuuma.current_app_organisation_id()) AND (actor_user_id = nabuuma.current_app_user_id()) AND (nabuuma.current_app_user_id() IS NOT NULL) AND nabuuma.is_active_member(organisation_id, nabuuma.current_app_user_id()))'
        ) INTO insert_policy_valid;
        IF NOT insert_policy_valid THEN
            DROP POLICY IF EXISTS audit_events_tenant_insert ON nabuuma.audit_events;
            CREATE POLICY audit_events_tenant_insert ON nabuuma.audit_events FOR INSERT TO nabuuma_app WITH CHECK (
                organisation_id = nabuuma.current_app_organisation_id()
                AND actor_user_id = nabuuma.current_app_user_id()
                AND nabuuma.current_app_user_id() IS NOT NULL
                AND nabuuma.is_active_member(organisation_id, nabuuma.current_app_user_id())
            );
        END IF;
    END;
    $policy_reconcile$;
    GRANT SELECT, INSERT ON nabuuma.audit_events TO nabuuma_app;

    -- Retain the existing immutable trigger when its event/timing/function
    -- contract is already canonical. Replace only a missing or mismatched one.
    DO $trigger_reconcile$
    DECLARE
        trigger_valid BOOLEAN;
    BEGIN
        SELECT EXISTS (
            SELECT 1 FROM pg_trigger
             WHERE tgrelid='nabuuma.audit_events'::regclass
               AND tgname='trg_audit_events_immutable'
               AND NOT tgisinternal
               AND tgtype=27
               AND tgfoid='nabuuma.reject_audit_event_mutation()'::regprocedure
        ) INTO trigger_valid;
        IF NOT trigger_valid THEN
            DROP TRIGGER IF EXISTS trg_audit_events_immutable ON nabuuma.audit_events;
            CREATE TRIGGER trg_audit_events_immutable
                BEFORE UPDATE OR DELETE ON nabuuma.audit_events
                FOR EACH ROW EXECUTE FUNCTION nabuuma.reject_audit_event_mutation();
        END IF;
    END;
    $trigger_reconcile$;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'nabuuma.audit_events'::regclass AND conname = 'audit_events_actor_fk') THEN
        ALTER TABLE nabuuma.audit_events ADD CONSTRAINT audit_events_actor_fk FOREIGN KEY (actor_user_id) REFERENCES nabuuma.users(id) ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'nabuuma.audit_events'::regclass AND conname = 'audit_events_organisation_fk') THEN
        ALTER TABLE nabuuma.audit_events ADD CONSTRAINT audit_events_organisation_fk FOREIGN KEY (organisation_id) REFERENCES nabuuma.organisations(id) ON DELETE RESTRICT;
    END IF;
END;
$audit_reconcile$;

COMMIT;
