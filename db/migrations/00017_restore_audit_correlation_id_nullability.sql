BEGIN;

-- Restore the canonical contract established by migration 00005.
-- correlation_id is optional when no request or business correlation
-- identifier exists.
ALTER TABLE nabuuma.audit_events
    ALTER COLUMN correlation_id
    DROP NOT NULL;

-- Reconcile every currently attached monthly partition whose physical
-- schema retained an independently enforced NOT NULL constraint.
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
            'ALTER TABLE nabuuma.%I ALTER COLUMN correlation_id DROP NOT NULL',
            partition_name
        );
    END LOOP;
END;
$migration$;

COMMIT;
