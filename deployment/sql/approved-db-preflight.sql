-- Confidential, read-only target preflight. Fails closed on baseline drift.
-- Execute with: psql -X -w -v ON_ERROR_STOP=1 -f this-file.sql
-- This file is NOT migration authority and does not prove a backup exists.
BEGIN READ ONLY;
SET LOCAL search_path = pg_catalog;
DO $preflight$
DECLARE
  audit_rows bigint;
  audit_digest text;
  audit_min timestamptz;
  audit_max timestamptz;
  partition_count integer;
  default_count integer;
  invalid_rows bigint;
  orphan_rows bigint;
  audit_kind "char";
  partition_key text;
  pk text[];
BEGIN
  IF current_database() <> 'nabuuma_rls_test' THEN
    RAISE EXCEPTION 'Unexpected database identity';
  END IF;
  IF current_setting('server_version_num')::integer / 10000 <> 18 THEN
    RAISE EXCEPTION 'Unexpected PostgreSQL major version';
  END IF;
  IF current_setting('transaction_read_only') <> 'on' THEN
    RAISE EXCEPTION 'Preflight transaction is not read-only';
  END IF;
  SELECT count(*),
         md5(COALESCE(string_agg(to_jsonb(a)::text,E'\n' ORDER BY id,occurred_at),'')),
         min(occurred_at), max(occurred_at)
    INTO audit_rows,audit_digest,audit_min,audit_max
    FROM nabuuma.audit_events a;
  IF audit_rows <> 9 OR audit_digest <> '267ca16fc4a03b6caddba1617d521a1e' THEN
    RAISE EXCEPTION 'Audit baseline drift: rows %, digest %',audit_rows,audit_digest;
  END IF;
  SELECT relkind,pg_get_partkeydef(oid) INTO audit_kind,partition_key
    FROM pg_class WHERE oid='nabuuma.audit_events'::regclass;
  IF audit_kind <> 'p' OR partition_key <> 'RANGE (occurred_at)' THEN
    RAISE EXCEPTION 'Audit partition parent/key drift';
  END IF;
  SELECT count(*) INTO partition_count FROM pg_inherits WHERE inhparent='nabuuma.audit_events'::regclass;
  SELECT count(*) INTO default_count FROM pg_inherits i JOIN pg_class c ON c.oid=i.inhrelid
    WHERE i.inhparent='nabuuma.audit_events'::regclass AND pg_get_expr(c.relpartbound,c.oid)='DEFAULT';
  IF partition_count <> 24 OR default_count <> 0 THEN
    RAISE EXCEPTION 'Audit partition inventory drift: children %, DEFAULT %',partition_count,default_count;
  END IF;
  SELECT array_agg(a.attname ORDER BY k.ordinality) INTO pk
    FROM pg_constraint c JOIN unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality) ON true
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
    WHERE c.conrelid='nabuuma.audit_events'::regclass AND c.contype='p';
  IF pk IS DISTINCT FROM ARRAY['id','occurred_at']::text[] THEN RAISE EXCEPTION 'Audit PK drift'; END IF;
  IF to_regprocedure('nabuuma.resolve_certificate_id_for_revocation(text)') IS NOT NULL
     OR to_regclass('nabuuma.external_identities') IS NOT NULL
     OR to_regprocedure('nabuuma.resolve_external_identity(text,text,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Unexpected 00020/00021/00022 object already exists; stop and reclassify migration state';
  END IF;
  SELECT count(*) INTO invalid_rows FROM nabuuma.audit_events
   WHERE id IS NULL OR organisation_id IS NULL OR actor_user_id IS NULL OR action IS NULL
     OR length(action)>100 OR entity_type IS NULL OR length(entity_type)>50 OR entity_id IS NULL
     OR occurred_at IS NULL OR outcome IS NULL OR length(outcome)>20
     OR outcome NOT IN ('SUCCESS','FAILURE') OR metadata IS NULL OR jsonb_typeof(metadata)<>'object';
  SELECT count(*) INTO orphan_rows FROM nabuuma.audit_events a
    LEFT JOIN nabuuma.organisations o ON o.id=a.organisation_id
    LEFT JOIN nabuuma.users u ON u.id=a.actor_user_id
    WHERE o.id IS NULL OR u.id IS NULL;
  IF invalid_rows <> 0 OR orphan_rows <> 0 THEN RAISE EXCEPTION 'Audit integrity drift: invalid %, orphan %',invalid_rows,orphan_rows; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='nabuuma_runtime' AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)) THEN
    RAISE EXCEPTION 'Runtime role attributes unsafe';
  END IF;
  IF has_schema_privilege('nabuuma_runtime','nabuuma','USAGE')
     OR has_function_privilege('nabuuma_runtime','nabuuma.verify_academy_certificate(text)','EXECUTE')
     OR has_table_privilege('nabuuma_runtime','nabuuma.academy_certificates','SELECT')
     OR pg_has_role('nabuuma_runtime','nabuuma_certificate_verifier','MEMBER') THEN
    RAISE EXCEPTION '00020 baseline authority unexpectedly present';
  END IF;
  RAISE NOTICE 'READ_ONLY_PREFLIGHT_PASS database=% server=% rows=% digest=% min=% max=% children=% default=% invalid=% orphan=% user=%',
    current_database(),version(),audit_rows,audit_digest,audit_min,audit_max,partition_count,default_count,invalid_rows,orphan_rows,current_user;
END;
$preflight$;
SELECT current_database() AS database_name,
       current_user AS executing_identity,
       session_user AS session_identity,
       current_setting('transaction_read_only') AS transaction_read_only,
       version() AS server_version,
       (SELECT count(*) FROM nabuuma.audit_events) AS audit_rows,
       (SELECT md5(COALESCE(string_agg(to_jsonb(a)::text,E'\n' ORDER BY id,occurred_at),'')) FROM nabuuma.audit_events a) AS audit_digest,
       (SELECT min(occurred_at) FROM nabuuma.audit_events) AS audit_min,
       (SELECT max(occurred_at) FROM nabuuma.audit_events) AS audit_max,
       (SELECT count(*) FROM pg_inherits WHERE inhparent='nabuuma.audit_events'::regclass) AS partition_count;
ROLLBACK;
