#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "$BACKUP_FILE"
: "$RESTORE_DATABASE_URL"
: "$NABUUMA_RESTORE_TARGET_DISPOSABLE"
: "$SOURCE_MANIFEST_FILE"
: "$CERTIFICATE_NUMBER"
: "$IDENTITY_PROVIDER"
: "$IDENTITY_SUBJECT"
: "$EXPECTED_USER_ID"
: "$EXPECTED_ORGANISATION_ID"
: "$EXPECTED_ROLE"

[[ "$NABUUMA_RESTORE_TARGET_DISPOSABLE" == "YES" ]] || { echo "Refusing restore: acknowledgement must be YES." >&2; exit 2; }
[[ -f "$BACKUP_FILE" && ! -L "$BACKUP_FILE" ]] || { echo "Backup must be a regular non-symlink file." >&2; exit 2; }
[[ -f "$SOURCE_MANIFEST_FILE" && ! -L "$SOURCE_MANIFEST_FILE" ]] || { echo "Source manifest missing." >&2; exit 2; }
db_name="$(node -e 'const u=new URL(process.env.RESTORE_DATABASE_URL);process.stdout.write(decodeURIComponent(u.pathname.slice(1)))')"
case "$db_name" in *restore*|*disposable*|*drill*|*recovery_test*) ;; *) echo "Target name must identify restore/drill database." >&2; exit 2;; esac
for cmd in pg_restore psql sha256sum node; do command -v "$cmd" >/dev/null || { echo "Missing $cmd" >&2; exit 2; }; done

pg_restore --list "$BACKUP_FILE" >/dev/null
if [[ -f "$BACKUP_FILE.sha256" ]]; then (cd "$(dirname "$BACKUP_FILE")" && sha256sum -c "$(basename "$BACKUP_FILE").sha256"); fi
echo "Restoring into NEW disposable target: $db_name"
pg_restore --exit-on-error --dbname="$RESTORE_DATABASE_URL" "$BACKUP_FILE"

psql "$RESTORE_DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
DO $verify$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity
             FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='nabuuma'
              AND c.relname IN ('audit_events','external_identities','academy_certificates','academy_courses','organisation_memberships')
  LOOP
    IF NOT r.relrowsecurity OR (r.relname <> 'organisation_memberships' AND NOT r.relforcerowsecurity) THEN RAISE EXCEPTION 'RLS/FORCE RLS missing on %',r.relname; END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='nabuuma') < 10 THEN RAISE EXCEPTION 'Expected policies missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_audit_events_immutable' AND NOT tgisinternal) THEN RAISE EXCEPTION 'Audit immutability trigger missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_assessment_immutable' AND NOT tgisinternal) THEN RAISE EXCEPTION 'Assessment immutability trigger missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_certificate_revocations_immutable' AND NOT tgisinternal) THEN RAISE EXCEPTION 'Certificate revocation trigger missing'; END IF;
  IF (SELECT count(*) FROM pg_inherits i JOIN pg_class p ON p.oid=i.inhparent JOIN pg_namespace n ON n.oid=p.relnamespace WHERE n.nspname='nabuuma' AND p.relname='audit_events') < 25 THEN RAISE EXCEPTION 'Audit partitions missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='nabuuma.resolve_external_identity(text,text,uuid)'::regprocedure AND prosecdef AND proconfig @> ARRAY['search_path=pg_catalog']) THEN RAISE EXCEPTION 'Resolver hardening missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='nabuuma.verify_academy_certificate(text)'::regprocedure AND prosecdef AND proconfig @> ARRAY['search_path=pg_catalog']) THEN RAISE EXCEPTION 'Verifier hardening missing'; END IF;
  IF pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='nabuuma.resolve_external_identity(text,text,uuid)'::regprocedure)) <> 'nabuuma_auth_owner' THEN RAISE EXCEPTION 'Resolver owner incorrect'; END IF;
  IF pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid='nabuuma.verify_academy_certificate(text)'::regprocedure)) <> 'nabuuma_auth_owner' THEN RAISE EXCEPTION 'Verifier owner incorrect'; END IF;
  IF NOT has_function_privilege('nabuuma_runtime','nabuuma.resolve_external_identity(text,text,uuid)','EXECUTE') OR NOT has_function_privilege('nabuuma_runtime','nabuuma.verify_academy_certificate(text)','EXECUTE') THEN RAISE EXCEPTION 'Runtime function grants missing'; END IF;
  IF has_table_privilege('nabuuma_runtime','nabuuma.external_identities','SELECT') OR has_table_privilege('nabuuma_runtime','nabuuma.organisation_memberships','SELECT') THEN RAISE EXCEPTION 'Runtime direct identity SELECT unexpectedly granted'; END IF;
END
$verify$;
SQL

identity_result="$(psql "$RESTORE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atc "SELECT user_id||'|'||organisation_id||'|'||role::text FROM nabuuma.resolve_external_identity('$IDENTITY_PROVIDER','$IDENTITY_SUBJECT',NULL)")"
[[ "$identity_result" == "$EXPECTED_USER_ID|$EXPECTED_ORGANISATION_ID|$EXPECTED_ROLE" ]] || { echo "Resolver mismatch: $identity_result" >&2; exit 1; }
certificate_result="$(psql "$RESTORE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atc "SELECT valid::text||'|'||certificate_number||'|'||course_title FROM nabuuma.verify_academy_certificate('$CERTIFICATE_NUMBER')")"
[[ "$certificate_result" == "true|$CERTIFICATE_NUMBER|Synthetic Espresso Foundations" ]] || { echo "Verifier mismatch: $certificate_result" >&2; exit 1; }
if psql "$RESTORE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atc "SET ROLE nabuuma_runtime; SELECT count(*) FROM nabuuma.external_identities" >/dev/null 2>&1; then echo "ERROR runtime direct SELECT unexpectedly succeeded" >&2; exit 1; fi
runtime_result="$(psql "$RESTORE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atc "SET ROLE nabuuma_runtime; SELECT user_id FROM nabuuma.resolve_external_identity('$IDENTITY_PROVIDER','$IDENTITY_SUBJECT',NULL); SELECT valid FROM nabuuma.verify_academy_certificate('$CERTIFICATE_NUMBER')" | tail -n 2)"
[[ "$runtime_result" == "$EXPECTED_USER_ID"$'\n't ]] || { echo "Runtime function mismatch: $runtime_result" >&2; exit 1; }

MANIFEST_FILE="$BACKUP_FILE.restore-manifest.json" DATABASE_URL="$RESTORE_DATABASE_URL" node "$(dirname "$0")/database-state-manifest.mjs" >/dev/null
node - "$SOURCE_MANIFEST_FILE" "$BACKUP_FILE.restore-manifest.json" <<'NODE'
const fs=require('node:fs');
const source=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const restored=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
delete source.created_at; delete source.database;
delete restored.created_at; delete restored.database;
if(JSON.stringify(source)!==JSON.stringify(restored)){ console.error('Source/restore manifests differ.'); process.exit(1); }
console.log('ROW COUNTS + DIGESTS + TABLE OWNERS/RLS + POLICIES + TRIGGERS + FUNCTIONS/OWNERS/ACL + SCHEMA ACL MATCH');
NODE
echo BACKUP_RESTORE_VERIFIED=YES
