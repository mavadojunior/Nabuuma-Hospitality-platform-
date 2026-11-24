BEGIN;

-- Restore server-side audit identifier generation lost when the audit ledger
-- was converted to monthly partitioning. PgAuditRepository intentionally
-- omits id and relies on PostgreSQL to generate it.
ALTER TABLE nabuuma.audit_events
    ALTER COLUMN id
    SET DEFAULT gen_random_uuid();

-- Existing attached partitions may retain independent column-default
-- metadata. Reconcile every currently attached leaf rather than relying on
-- parent-default propagation for partitions created before this migration.
DO $migration$
DECLARE
    partition_name TEXT;
BEGIN
    FOR partition_name IN
        SELECT child.relname
        FROM pg_inherits AS inheritance
        JOIN pg_class AS parent
          ON parent.oid = inheritance.inhparent
        JOIN pg_namespace AS namespace
          ON namespace.oid = parent.relnamespace
        JOIN pg_class AS child
          ON child.oid = inheritance.inhrelid
        WHERE namespace.nspname = 'nabuuma'
          AND parent.relname = 'audit_events'
          AND child.relkind = 'r'
        ORDER BY child.relname
    LOOP
        EXECUTE format(
            'ALTER TABLE nabuuma.%I ALTER COLUMN id SET DEFAULT gen_random_uuid()',
            partition_name
        );
    END LOOP;
END;
$migration$;

COMMIT;
