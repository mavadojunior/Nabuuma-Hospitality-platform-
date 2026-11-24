#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail
umask 077

# Nabuuma release verifier.
# Fail-closed policy: a gate is PASS only after its own assertions succeed.
# Unknown fixtures, unverified test coverage, and unavailable external identity
# are never converted into PASS.

declare -A G=()
GATES=(
  POSTGRESQL
  RUNTIME_AUTH_7_OF_7
  MIGRATION_ORDER
  MIGRATION_00013
  MIGRATION_00014
  CONSTRAINED_LOGIN
  ROLE_SWITCHING
  NON_OWNER_RLS
  POOL_COMMIT
  POOL_ROLLBACK
  DB_SECURITY_SUITE
  TYPECHECK
  BUILD
  ESM
  BOOT_SCRIPT
  REAL_TCP_SERVICE
  HEALTH_LIVE
  HEALTH_READY
  LIVE_NEGATIVE_AUTH
  LIVE_POSITIVE_MCP
  CLEAN_SHUTDOWN
  CLEANUP
  GIT_DIFF
)

for gate in "${GATES[@]}"; do
  G["$gate"]="NOT EXECUTED"
done

ROOT="$HOME/Nabuuma-Hospitality-platform-"
DB_HOST="127.0.0.1"
DB_PORT="55433"
DB_NAME="nabuuma_rls_test"
DB_ADMIN="u0_a427"

VERIFY_ROLE=""
VERIFY_PASSWORD=""
ADMIN_PASSWORD=""
DATABASE_URL=""
SERVER_PID=""
SERVER_OWNED=0
ROLE_OWNED=0
CLEANING=0
CLEANUP_DONE=0
EXIT_STATUS=0
TMP_FILES=()
TEST_LOG=""
SUITE_LOG=""
BUILD_LOG=""
ESM_LOG=""
BOOT_FILE="scripts/termux-boot/start-nabuuma.sh"

pass() {
  printf '[PASS] %s\n' "$*"
}

fail() {
  printf '[FAIL] %s\n' "$*" >&2
  return 1
}

record_pass() {
  G["$1"]="PASS"
  pass "$1"
}

record_fail() {
  G["$1"]="FAIL"
  fail "$1"
}

record_na() {
  G["$1"]="NOT EXECUTABLE"
  printf '[NOT EXECUTABLE] %s: %s\n' "$1" "$2"
}

record_not_executed() {
  printf '[NOT EXECUTED] %s: %s\n' "$1" "$2"
}

new_tmp() {
  local file
  file="$(mktemp "${TMPDIR:-/data/data/com.termux/files/usr/tmp}/nabuuma-release.XXXXXX")"
  TMP_FILES+=("$file")
  NEW_TMP_FILE="$file"
}

run_gate() {
  local gate="$1"
  shift
  printf '\n=== %s ===\n' "$gate"
  if "$@"; then
    record_pass "$gate"
    return 0
  fi
  record_fail "$gate"
  return 1
}

cleanup_resources() {
  local sql_status=0
  local file
  local role_absent=""

  if (( CLEANUP_DONE )); then
    return 0
  fi

  if (( CLEANING )); then
    printf '[FAIL] Recursive cleanup invocation detected.\n' >&2
    return 1
  fi

  CLEANING=1
  printf '\n=== CLEANUP ===\n'

  # Stop only the process explicitly owned by this driver.
  if (( SERVER_OWNED )) && [[ -n "$SERVER_PID" ]]; then
    if kill -0 "$SERVER_PID" 2>/dev/null; then
      kill -TERM "$SERVER_PID" 2>/dev/null || true
      wait "$SERVER_PID" 2>/dev/null || true

      if kill -0 "$SERVER_PID" 2>/dev/null; then
        printf '[FAIL] Script-owned server is still running: PID %s\n' "$SERVER_PID" >&2
        sql_status=1
      else
        printf '[PASS] Script-owned server stopped.\n'
      fi
    fi
  fi

  # Revoke memberships and drop only the temporary role created by this run.
  if (( ROLE_OWNED )) && [[ -n "$VERIFY_ROLE" ]]; then
    if [[ -z "$ADMIN_PASSWORD" ]]; then
      printf '[FAIL] Cannot remove temporary role: admin credential unavailable.\n' >&2
      sql_status=1
    else
      if ! PGPASSWORD="$ADMIN_PASSWORD" psql -X -w \
        -h "$DB_HOST" -p "$DB_PORT" -U "$DB_ADMIN" -d "$DB_NAME" \
        -v ON_ERROR_STOP=1 -v verify_role="$VERIFY_ROLE" \
        >/dev/null 2>&1 <<'SQL'
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE usename = :'verify_role'
  AND pid <> pg_backend_pid();

SELECT format(
  'REVOKE nabuuma_app, nabuuma_certificate_verifier FROM %I',
  :'verify_role'
)
WHERE EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = :'verify_role'
)
\gexec

SELECT format('DROP ROLE %I', :'verify_role')
WHERE EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = :'verify_role'
)
\gexec
SQL
      then
        printf '[FAIL] Temporary role cleanup SQL failed.\n' >&2
        sql_status=1
      else
        if role_absent="$(
          PGPASSWORD="$ADMIN_PASSWORD" psql -X -w \
            -h "$DB_HOST" -p "$DB_PORT" -U "$DB_ADMIN" -d "$DB_NAME" \
            -v ON_ERROR_STOP=1 -v verify_role="$VERIFY_ROLE" -Atq <<'SQL'
SELECT NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = :'verify_role'
);
SQL
        )"; then
          if [[ "$role_absent" == "t" ]]; then
            printf '[PASS] Temporary role removal verified.\n'
          else
            printf '[FAIL] Temporary role still exists after cleanup.\n' >&2
            sql_status=1
          fi
        else
          printf '[FAIL] Could not verify temporary role removal.\n' >&2
          sql_status=1
        fi
      fi
    fi
  fi

  # Remove and verify only temporary files registered by this process.
  for file in "${TMP_FILES[@]:-}"; do
    [[ -n "$file" ]] || continue

    if [[ -e "$file" || -L "$file" ]]; then
      if ! rm -f -- "$file"; then
        printf '[FAIL] Could not remove temporary file: %s\n' "$file" >&2
        sql_status=1
        continue
      fi
    fi

    if [[ -e "$file" || -L "$file" ]]; then
      printf '[FAIL] Temporary file remains: %s\n' "$file" >&2
      sql_status=1
    fi
  done

  if (( sql_status != 0 )); then
    G[CLEANUP]="FAIL"
    CLEANING=0
    printf '[FAIL] Cleanup incomplete; a later EXIT cleanup attempt may retry.\n' >&2
    return 1
  fi

  CLEANUP_DONE=1
  CLEANING=0
  G[CLEANUP]="PASS"
  pass "CLEANUP"
  return 0
}

cleanup() {
  local original_status=$?

  trap - EXIT INT TERM

  if ! cleanup_resources; then
    original_status=1
  fi

  unset VERIFY_PASSWORD DATABASE_URL ADMIN_PASSWORD PGPASSWORD 2>/dev/null || true
  exit "$original_status"
}

on_signal() {
  printf '\n[FAIL] Release driver interrupted.\n' >&2
  exit 130
}

trap cleanup EXIT
trap on_signal INT TERM

printf '=== NABUUMA RELEASE DRIVER ===\n'

# ---------------------------------------------------------------------------
# Driver identity and repository preflight
# ---------------------------------------------------------------------------

if [[ -z "${BASH_SOURCE[0]:-}" ||
      "${BASH_SOURCE[0]}" == "/dev/stdin" ||
      "${BASH_SOURCE[0]}" == "stdin" ||
      ! -f "${BASH_SOURCE[0]}" ]]; then
  printf '[FAIL] Driver must execute from a regular file; stdin execution rejected.\n' >&2
  exit 2
fi

SCRIPT_PATH="$(readlink -f -- "${BASH_SOURCE[0]}")"
[[ -n "$SCRIPT_PATH" && -f "$SCRIPT_PATH" ]] || {
  printf '[FAIL] Cannot resolve driver file identity.\n' >&2
  exit 2
}
pass "DRIVER FILE EXECUTION: PASS"

[[ "$(pwd -P)" == "$(readlink -f "$ROOT")" ]] || {
  printf '[FAIL] Unexpected working directory.\n' >&2
  exit 1
}

[[ "$(git rev-parse --show-toplevel)" == "$(pwd -P)" ]] || {
  printf '[FAIL] Repository root assertion failed.\n' >&2
  exit 1
}

for cmd in git node npm npx psql pg_isready curl python; do
  command -v "$cmd" >/dev/null 2>&1 || {
    printf '[FAIL] Required command missing: %s\n' "$cmd" >&2
    exit 1
  }
done

BRANCH="$(git branch --show-current)"
HEAD="$(git rev-parse HEAD)"
INITIAL_STATUS="$(git status --short --untracked-files=all)"
CACHED_STAT="$(git diff --cached --stat)"
UNCACHED_STAT="$(git diff --stat)"

printf 'Repository: %s\nBranch: %s\nHEAD: %s\n' "$ROOT" "$BRANCH" "$HEAD"
printf '%s\n' '--- Initial status ---' "$INITIAL_STATUS"
printf '%s\n' '--- Cached diff stat ---' "$CACHED_STAT"
printf '%s\n' '--- Uncached diff stat ---' "$UNCACHED_STAT"

git diff --check
git diff --cached --check

for artefact in \
  "how --format=fuller --stat " \
  "tatus --short --branch"
do
  [[ ! -e "$artefact" ]] || {
    printf '[FAIL] Known accidental artefact exists: %q\n' "$artefact" >&2
    printf '[INFO] Release verification will not delete user files.\n' >&2
    exit 1
  }
done


# ---------------------------------------------------------------------------
# PostgreSQL connection and administrator authentication
# ---------------------------------------------------------------------------

printf '\n=== POSTGRESQL CONNECTION ===\n'
if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" >/dev/null 2>&1; then
  record_fail POSTGRESQL
  exit 1
fi

read -r -s -p "PostgreSQL password for ${DB_ADMIN}: " ADMIN_PASSWORD
printf '\n'

DB_INFO="$(PGPASSWORD="$ADMIN_PASSWORD" psql -X -w \
  -h "$DB_HOST" -p "$DB_PORT" -U "$DB_ADMIN" -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 -Atqc \
  "SELECT current_database() || '|' || current_setting('server_version');")"

IFS='|' read -r ACTUAL_DB SERVER_VERSION <<<"$DB_INFO"
[[ "$ACTUAL_DB" == "$DB_NAME" && -n "$SERVER_VERSION" ]] || {
  record_fail POSTGRESQL
  fail "Connected database identity/version assertion failed."
  exit 1
}
pass "Database identity: $ACTUAL_DB"
pass "PostgreSQL server version: $SERVER_VERSION"
record_pass POSTGRESQL

# ---------------------------------------------------------------------------
# Migration ordering
# ---------------------------------------------------------------------------

printf '\n=== MIGRATION ORDER ===\n'
shopt -s nullglob
MIGRATIONS=(db/migrations/*.sql)
shopt -u nullglob

[[ ${#MIGRATIONS[@]} -gt 0 ]] || {
  record_fail MIGRATION_ORDER
  exit 1
}

declare -A ORDINALS=()
COUNT_13=0
COUNT_14=0
PREVIOUS=""
for migration in "${MIGRATIONS[@]}"; do
  base="${migration##*/}"
  ordinal="${base%%_*}"
  [[ "$ordinal" =~ ^[0-9]{5}$ ]] || continue
  [[ -z "${ORDINALS[$ordinal]:-}" ]] || {
    record_fail MIGRATION_ORDER
    fail "Duplicate migration ordinal: $ordinal"
    exit 1
  }
  ORDINALS["$ordinal"]="$base"
  [[ "$ordinal" != "00013" ]] || { COUNT_13=$((COUNT_13 + 1)); FILE_13="$migration"; }
  [[ "$ordinal" != "00014" ]] || { COUNT_14=$((COUNT_14 + 1)); FILE_14="$migration"; }
  PREVIOUS="$ordinal"
done

[[ "$COUNT_13" -eq 1 && "$COUNT_14" -eq 1 ]] || {
  record_fail MIGRATION_ORDER
  fail "Migrations 00013 and 00014 must each exist exactly once."
  exit 1
}
[[ "${FILE_13##*/}" < "${FILE_14##*/}" ]] || {
  record_fail MIGRATION_ORDER
  fail "Migration 00013 must sort before 00014."
  exit 1
}
record_pass MIGRATION_ORDER

# ---------------------------------------------------------------------------
# Migration 00013: exact catalogue assertion and permanent regression test
# ---------------------------------------------------------------------------

printf '\n=== MIGRATION 00013 CATALOGUE STATE ===\n'

POLICY_QUERY="
SELECT
  p.polname || '|' ||
  COALESCE(pg_get_expr(p.polqual, p.polrelid), '') || '|' ||
  COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'nabuuma'
  AND p.polname IN ('academy_lessons_select','academy_enrolments_insert')
ORDER BY p.polname;
"

POLICY_STATE="$(PGPASSWORD="$ADMIN_PASSWORD" psql -X -w \
  -h "$DB_HOST" -p "$DB_PORT" -U "$DB_ADMIN" -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 -Atqc "$POLICY_QUERY")" || {
    record_fail MIGRATION_00013
    exit 1
  }

POLICY_OK=1
grep -Fq 'course.id = academy_lessons.course_id' <<<"$POLICY_STATE" || POLICY_OK=0
grep -Fq 'course.organisation_id = academy_lessons.organisation_id' <<<"$POLICY_STATE" || POLICY_OK=0
grep -Fq 'course.id = academy_enrolments.course_id' <<<"$POLICY_STATE" || POLICY_OK=0
grep -Fq 'course.organisation_id = academy_enrolments.organisation_id' <<<"$POLICY_STATE" || POLICY_OK=0

if (( ! POLICY_OK )); then
  printf '[INFO] Corrected 00013 catalogue state absent; applying migration once.\n'
  PGPASSWORD="$ADMIN_PASSWORD" psql -X -w \
    -h "$DB_HOST" -p "$DB_PORT" -U "$DB_ADMIN" -d "$DB_NAME" \
    -v ON_ERROR_STOP=1 -f "$FILE_13" || {
      record_fail MIGRATION_00013
      exit 1
    }

  POLICY_STATE="$(PGPASSWORD="$ADMIN_PASSWORD" psql -X -w \
    -h "$DB_HOST" -p "$DB_PORT" -U "$DB_ADMIN" -d "$DB_NAME" \
    -v ON_ERROR_STOP=1 -Atqc "$POLICY_QUERY")" || {
      record_fail MIGRATION_00013
      exit 1
    }
fi

POLICY_OK=1
grep -Fq 'course.id = academy_lessons.course_id' <<<"$POLICY_STATE" || POLICY_OK=0
grep -Fq 'course.organisation_id = academy_lessons.organisation_id' <<<"$POLICY_STATE" || POLICY_OK=0
grep -Fq 'course.id = academy_enrolments.course_id' <<<"$POLICY_STATE" || POLICY_OK=0
grep -Fq 'course.organisation_id = academy_enrolments.organisation_id' <<<"$POLICY_STATE" || POLICY_OK=0

if (( ! POLICY_OK )); then
  record_fail MIGRATION_00013
  fail "00013 catalogue definitions do not contain all four required qualified correlations."
  exit 1
fi

# A permanent regression must be present and contain explicit behavioural
# assertions. No dynamic test source is generated by this driver.
REGRESSION_FILES=()
while IFS= read -r -d '' file; do
  if grep -Eiq 'academy_lessons_select|academy_enrolments_insert' "$file" &&
     grep -Eiq 'cross.?tenant|different tenant|tenant isolation' "$file" &&
     grep -Eiq 'published|enrolment|enrollment' "$file"; then
    REGRESSION_FILES+=("$file")
  fi
done < <(find tests -type f \( -name '*.test.ts' -o -name '*.spec.ts' \) -print0 2>/dev/null)

if [[ ${#REGRESSION_FILES[@]} -eq 0 ]]; then
  record_fail MIGRATION_00013
  fail "MISSING REGRESSION COVERAGE: no permanent 00013 cross-tenant behavioural test found."
  exit 1
fi

new_tmp
TEST_13_LOG="$NEW_TMP_FILE"

if ! RUN_RLS_INTEGRATION="1" \
  PGHOST="$DB_HOST" \
  PGPORT="$DB_PORT" \
  PGDATABASE="$DB_NAME" \
  PGUSER="$DB_ADMIN" \
  PGPASSWORD="$ADMIN_PASSWORD" \
  npx vitest run "${REGRESSION_FILES[@]}" \
    --pool=forks \
    --maxWorkers=1 \
    --reporter=verbose 2>&1 | tee "$TEST_13_LOG"
then
  record_fail MIGRATION_00013
  exit 1
fi
if grep -Eiq '([1-9][0-9]* skipped|[1-9][0-9]* todo)' "$TEST_13_LOG"; then
  record_fail MIGRATION_00013
  fail "00013 regression run contains skipped or todo tests."
  exit 1
fi
record_pass MIGRATION_00013

# ---------------------------------------------------------------------------
# Migration 00014: apply only if role is absent; then assert catalogue state
# ---------------------------------------------------------------------------

printf '\n=== MIGRATION 00014 CATALOGUE STATE ===\n'
ROLE_EXISTS="$(PGPASSWORD="$ADMIN_PASSWORD" psql -X -w \
  -h "$DB_HOST" -p "$DB_PORT" -U "$DB_ADMIN" -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 -Atqc \
  "SELECT count(*) FROM pg_roles WHERE rolname='nabuuma_auth_owner';")"

if [[ "$ROLE_EXISTS" == "0" ]]; then
  PGPASSWORD="$ADMIN_PASSWORD" psql -X -w \
    -h "$DB_HOST" -p "$DB_PORT" -U "$DB_ADMIN" -d "$DB_NAME" \
    -v ON_ERROR_STOP=1 -f "$FILE_14" || {
      record_fail MIGRATION_00014
      exit 1
    }
fi

M14_STATE="$(PGPASSWORD="$ADMIN_PASSWORD" psql -X -w \
  -h "$DB_HOST" -p "$DB_PORT" -U "$DB_ADMIN" -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 -Atqc "
SELECT
  r.rolcanlogin, r.rolsuper, r.rolcreatedb, r.rolcreaterole,
  r.rolinherit, r.rolreplication, r.rolbypassrls
FROM pg_roles r WHERE r.rolname='nabuuma_auth_owner';
")" || {
  record_fail MIGRATION_00014
  exit 1
}

[[ "$M14_STATE" == "f|f|f|f|f|f|f" ]] || {
  record_fail MIGRATION_00014
  fail "nabuuma_auth_owner attributes do not match the required NOLOGIN/NO* state."
  exit 1
}

M14_CATALOG="$(PGPASSWORD="$ADMIN_PASSWORD" psql -X -w \
  -h "$DB_HOST" -p "$DB_PORT" -U "$DB_ADMIN" -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 -Atqc "
SELECT
  (SELECT has_schema_privilege('nabuuma_auth_owner','nabuuma','USAGE'))::text || '|' ||
  (SELECT has_schema_privilege('nabuuma_auth_owner','nabuuma','CREATE'))::text || '|' ||
  (SELECT pg_get_userbyid(relowner) FROM pg_class
   WHERE oid='nabuuma.organisation_memberships'::regclass) || '|' ||
  (SELECT pg_get_userbyid(relowner) FROM pg_class
   WHERE oid='nabuuma.trainer_learner_authorizations'::regclass) || '|' ||
  (SELECT pg_get_userbyid(proowner) FROM pg_proc
   WHERE oid='nabuuma.is_active_member(uuid,uuid)'::regprocedure) || '|' ||
  (SELECT pg_get_userbyid(proowner) FROM pg_proc
   WHERE oid='nabuuma.is_authorized_assessor(uuid,uuid,uuid)'::regprocedure) || '|' ||
  (SELECT prosecdef FROM pg_proc
   WHERE oid='nabuuma.is_active_member(uuid,uuid)'::regprocedure)::text || '|' ||
  (SELECT prosecdef FROM pg_proc
   WHERE oid='nabuuma.is_authorized_assessor(uuid,uuid,uuid)'::regprocedure)::text;
")" || {
  record_fail MIGRATION_00014
  exit 1
}

[[ "$M14_CATALOG" == "true|false|nabuuma_auth_owner|nabuuma_auth_owner|nabuuma_auth_owner|nabuuma_auth_owner|true|true" ]] || {
  record_fail MIGRATION_00014
  fail "00014 schema privileges, ownership, or SECURITY DEFINER assertions failed."
  exit 1
}

M14_ACL="$(PGPASSWORD="$ADMIN_PASSWORD" psql -X -w \
  -h "$DB_HOST" -p "$DB_PORT" -U "$DB_ADMIN" -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 -Atqc "
SELECT
  (SELECT NOT EXISTS (
    SELECT 1 FROM aclexplode(COALESCE(proacl, acldefault('f',proowner))) a
    WHERE a.grantee=0 AND a.privilege_type='EXECUTE'
  ) FROM pg_proc WHERE oid='nabuuma.is_active_member(uuid,uuid)'::regprocedure)
  AND
  (SELECT NOT EXISTS (
    SELECT 1 FROM aclexplode(COALESCE(proacl, acldefault('f',proowner))) a
    WHERE a.grantee=0 AND a.privilege_type='EXECUTE'
  ) FROM pg_proc WHERE oid='nabuuma.is_authorized_assessor(uuid,uuid,uuid)'::regprocedure)
  AND has_function_privilege('nabuuma_app','nabuuma.is_active_member(uuid,uuid)','EXECUTE')
  AND has_function_privilege('nabuuma_app','nabuuma.is_authorized_assessor(uuid,uuid,uuid)','EXECUTE')
  AND NOT pg_has_role('nabuuma_app','nabuuma_auth_owner','MEMBER');
")" || {
  record_fail MIGRATION_00014
  exit 1
}

[[ "$M14_ACL" == "t" ]] || {
  record_fail MIGRATION_00014
  fail "00014 function ACL or owner-role membership assertions failed."
  exit 1
}
record_pass MIGRATION_00014

# ---------------------------------------------------------------------------
# Temporary restricted login and role switching
# ---------------------------------------------------------------------------

printf '\n=== TEMPORARY RESTRICTED LOGIN ===\n'
VERIFY_ROLE="nabuuma_verify_$(
  node --input-type=module <<'NODE'
import { randomBytes } from "node:crypto";
process.stdout.write(randomBytes(16).toString("hex"));
NODE
)"
VERIFY_PASSWORD="$(
  node --input-type=module <<'NODE'
import { randomBytes } from "node:crypto";
process.stdout.write(randomBytes(32).toString("hex"));
NODE
)"

PGPASSWORD="$ADMIN_PASSWORD" psql -X -w \
  -h "$DB_HOST" -p "$DB_PORT" -U "$DB_ADMIN" -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 -v verify_role="$VERIFY_ROLE" \
  -v verify_password="$VERIFY_PASSWORD" <<'SQL'
BEGIN;

SELECT format(
  'CREATE ROLE %I LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L',
  :'verify_role', :'verify_password'
) \gexec

SELECT format('GRANT nabuuma_app, nabuuma_certificate_verifier TO %I',
              :'verify_role') \gexec

COMMIT;
SQL
ROLE_OWNED=1

ROLE_STATE="$(PGPASSWORD="$ADMIN_PASSWORD" psql -X -w \
  -h "$DB_HOST" -p "$DB_PORT" -U "$DB_ADMIN" -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 -v verify_role="$VERIFY_ROLE" -Atq <<'SQL'
SELECT rolcanlogin,rolinherit,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication
FROM pg_roles WHERE rolname = :'verify_role';
SQL
)"

[[ "$ROLE_STATE" == "t|f|f|f|f|f|f" ]] || {
  record_fail CONSTRAINED_LOGIN
  fail "Temporary role attributes are not exact."
  exit 1
}

MEMBERSHIP_STATE="$(PGPASSWORD="$ADMIN_PASSWORD" psql -X -w \
  -h "$DB_HOST" -p "$DB_PORT" -U "$DB_ADMIN" -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 -v verify_role="$VERIFY_ROLE" -Atq <<'SQL'
SELECT string_agg(r.rolname,',' ORDER BY r.rolname)
FROM pg_auth_members m
JOIN pg_roles r ON r.oid=m.roleid
JOIN pg_roles u ON u.oid=m.member
WHERE u.rolname = :'verify_role';
SQL
)"

[[ "$MEMBERSHIP_STATE" == "nabuuma_app,nabuuma_certificate_verifier" ]] || {
  record_fail CONSTRAINED_LOGIN
  fail "Temporary login membership set is not exact."
  exit 1
}

DIRECT_GRANTS="$(PGPASSWORD="$ADMIN_PASSWORD" psql -X -w \
  -h "$DB_HOST" -p "$DB_PORT" -U "$DB_ADMIN" -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 -v verify_role="$VERIFY_ROLE" -Atq <<'SQL'
SELECT count(*)
FROM information_schema.role_table_grants
WHERE grantee = :'verify_role';
SQL
)"

[[ "$DIRECT_GRANTS" == "0" ]] || {
  record_fail CONSTRAINED_LOGIN
  fail "Temporary login has direct table grants."
  exit 1
}
record_pass CONSTRAINED_LOGIN

# URL is held only in memory and is never printed.
DATABASE_URL="postgresql://${VERIFY_ROLE}:${VERIFY_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

printf '\n=== ROLE SWITCHING ===\n'
ROLE_SWITCH_OUTPUT="$(PGPASSWORD="$VERIFY_PASSWORD" psql -X -w \
  -h "$DB_HOST" -p "$DB_PORT" -U "$VERIFY_ROLE" -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 -Atqc "
SELECT session_user || '|' || current_user;
BEGIN;
SET LOCAL ROLE nabuuma_app;
SELECT session_user || '|' || current_user;
ROLLBACK;
BEGIN;
SET LOCAL ROLE nabuuma_certificate_verifier;
SELECT session_user || '|' || current_user;
ROLLBACK;
")" || {
  record_fail ROLE_SWITCHING
  exit 1
}

grep -Fqx "$VERIFY_ROLE|$VERIFY_ROLE" <<<"$ROLE_SWITCH_OUTPUT" || {
  record_fail ROLE_SWITCHING
  exit 1
}
grep -Fqx "$VERIFY_ROLE|nabuuma_app" <<<"$ROLE_SWITCH_OUTPUT" || {
  record_fail ROLE_SWITCHING
  exit 1
}
grep -Fqx "$VERIFY_ROLE|nabuuma_certificate_verifier" <<<"$ROLE_SWITCH_OUTPUT" || {
  record_fail ROLE_SWITCHING
  exit 1
}
record_pass ROLE_SWITCHING

# ---------------------------------------------------------------------------
# Runtime authentication integration: exactly seven tests, zero skipped
# ---------------------------------------------------------------------------

printf '\n=== RUNTIME AUTHENTICATION 7/7 ===\n'
export NABUUMA_TEST_DATABASE_URL="$DATABASE_URL"
new_tmp
TEST_LOG="$NEW_TMP_FILE"

set +e
npx vitest run tests/RuntimeAuthentication.integration.spec.ts \
  --pool=forks --maxWorkers=1 --reporter=verbose 2>&1 | tee "$TEST_LOG"
TEST_STATUS=${PIPESTATUS[0]}
set -e

if (( TEST_STATUS != 0 )); then
  record_fail RUNTIME_AUTH_7_OF_7
  exit 1
fi

for test_name in \
  "serves live and ready health checks" \
  "rejects requests without a bearer token" \
  "rejects malformed bearer tokens" \
  "rejects a token with wrong issuer" \
  "rejects a token with wrong audience" \
  "rejects a token with expired token" \
  "authenticates a signed token and reaches the course repository"
do
  grep -Fq "$test_name" "$TEST_LOG" || {
    record_fail RUNTIME_AUTH_7_OF_7
    fail "Required runtime-auth test not observed: $test_name"
    exit 1
  }
done

grep -Eq '1 file[^[:cntrl:]]*passed|1 passed' "$TEST_LOG" || {
  record_fail RUNTIME_AUTH_7_OF_7
  fail "Runtime-auth output did not prove one passing test file."
  exit 1
}
grep -Eq '7 tests? passed|7 passed' "$TEST_LOG" || {
  record_fail RUNTIME_AUTH_7_OF_7
  fail "Runtime-auth output did not prove seven passing tests."
  exit 1
}
! grep -Eiq '([1-9][0-9]* skipped|[1-9][0-9]* todo|7 skipped|1 skipped)' "$TEST_LOG" || {
  record_fail RUNTIME_AUTH_7_OF_7
  fail "Runtime-auth output contains skipped or todo tests."
  exit 1
}
record_pass RUNTIME_AUTH_7_OF_7

# ---------------------------------------------------------------------------
# RLS and pool regression coverage: fail closed if permanent tests are absent.
# These cannot be replaced by catalogue queries or hand-written SQL probes.
# ---------------------------------------------------------------------------

printf '\n=== NON-OWNER RLS REGRESSION COVERAGE ===\n'
RLS_TESTS=()
while IFS= read -r -d '' file; do
  if grep -Eiq 'tenant.?a|tenant.?b|organisation.?a|organisation.?b' "$file" &&
     grep -Eiq 'cross.?tenant|tenant isolation|fail.closed|missing.*context' "$file" &&
     grep -Eiq 'academy_|row.?level security|RLS' "$file"; then
    RLS_TESTS+=("$file")
  fi
done < <(find tests -type f \( -name '*.test.ts' -o -name '*.spec.ts' \) -print0 2>/dev/null)

if [[ ${#RLS_TESTS[@]} -eq 0 ]]; then
  record_fail NON_OWNER_RLS
  fail "MISSING REGRESSION COVERAGE: permanent non-owner tenant RLS tests not found."
  exit 1
fi

new_tmp
RLS_LOG="$NEW_TMP_FILE"
if ! RUN_RLS_INTEGRATION="1" \
  PGHOST="$DB_HOST" \
  PGPORT="$DB_PORT" \
  PGDATABASE="$DB_NAME" \
  PGUSER="$DB_ADMIN" \
  PGPASSWORD="$ADMIN_PASSWORD" \
  npx vitest run "${RLS_TESTS[@]}" \
    --pool=forks \
    --maxWorkers=1 \
    --reporter=verbose 2>&1 |
  tee "$RLS_LOG"
then
  record_fail NON_OWNER_RLS
  exit 1
fi
if grep -Eiq '([1-9][0-9]* skipped|[1-9][0-9]* todo)' "$RLS_LOG"; then
  record_fail NON_OWNER_RLS
  fail "RLS regression suite contains skipped or todo tests."
  exit 1
fi

# Require named behavioural assertions from permanent executed tests.
for assertion in \
  "rejects telemetry whose practice session belongs to another tenant" \
  "rejects evidence whose organisation does not match the active tenant" \
  "rejects evidence referencing a practice session from another tenant" \
  "academy_lessons_select rejects a published lesson whose correlated course is unpublished despite a cross-tenant published course" \
  "academy_enrolments_insert rejects enrolment into an unpublished course despite a cross-tenant published course" \
  "rejects cross-tenant revocation"
do
  grep -Fqi "$assertion" "$RLS_LOG" || {
    record_fail NON_OWNER_RLS
    fail "MISSING REGRESSION COVERAGE: executed RLS output lacks behavioural assertion: $assertion"
    exit 1
  }
done

record_pass NON_OWNER_RLS

printf '\n=== POOL COMMIT/ROLLBACK ISOLATION ===\n'
POOL_TESTS=()
while IFS= read -r -d '' file; do
  if grep -Fq 'PgTransactionManager' "$file" &&
     grep -Eiq 'max[[:space:]]*:[[:space:]]*1' "$file" &&
     grep -Eiq 'rollback' "$file" &&
     grep -Eiq 'commit' "$file"; then
    POOL_TESTS+=("$file")
  fi
done < <(find tests -type f \( -name '*.test.ts' -o -name '*.spec.ts' \) -print0 2>/dev/null)

if [[ ${#POOL_TESTS[@]} -eq 0 ]]; then
  record_fail POOL_COMMIT
  record_fail POOL_ROLLBACK
  fail "MISSING REGRESSION COVERAGE: real Pool/PgTransactionManager max=1 commit and rollback test not found."
  exit 1
fi

new_tmp
POOL_LOG="$NEW_TMP_FILE"

if ! NABUUMA_TEST_DATABASE_URL="$DATABASE_URL" \
  npx vitest run "${POOL_TESTS[@]}" \
    --pool=forks \
    --maxWorkers=1 \
    --reporter=verbose 2>&1 |
  tee "$POOL_LOG"
then
  record_fail POOL_COMMIT
  record_fail POOL_ROLLBACK
  exit 1
fi
if grep -Eiq '([1-9][0-9]* skipped|[1-9][0-9]* todo)' "$POOL_LOG"; then
  record_fail POOL_COMMIT
  record_fail POOL_ROLLBACK
  fail "Pool isolation regression run contains skipped or todo tests."
  exit 1
fi
grep -Fqi   "clears transaction-local role and RLS context after commit on a reused max: 1 connection"   "$POOL_LOG" || {
  record_fail POOL_COMMIT
  fail "Pool commit-isolation assertion not observed."
  exit 1
}

grep -Fqi   "clears transaction-local role and RLS context after rollback on a reused max: 1 connection"   "$POOL_LOG" || {
  record_fail POOL_ROLLBACK
  fail "Pool rollback-isolation assertion not observed."
  exit 1
}

record_pass POOL_COMMIT
record_pass POOL_ROLLBACK

# ---------------------------------------------------------------------------
# Complete DB-enabled security suite
# ---------------------------------------------------------------------------

printf '\n=== COMPLETE DATABASE-ENABLED SECURITY SUITE ===\n'
new_tmp
SUITE_LOG="$NEW_TMP_FILE"
set +e
RUN_RLS_INTEGRATION="1" \
PGHOST="$DB_HOST" \
PGPORT="$DB_PORT" \
PGDATABASE="$DB_NAME" \
PGUSER="$DB_ADMIN" \
PGPASSWORD="$ADMIN_PASSWORD" \
NABUUMA_TEST_DATABASE_URL="$DATABASE_URL" \
  npm run test:security -- --reporter=verbose 2>&1 | tee "$SUITE_LOG"
SUITE_STATUS=${PIPESTATUS[0]}
set -e

if (( SUITE_STATUS != 0 )); then
  record_fail DB_SECURITY_SUITE
  exit 1
fi
if grep -Eiq '([1-9][0-9]* failed|[1-9][0-9]* skipped|[1-9][0-9]* todo)' "$SUITE_LOG"; then
  record_fail DB_SECURITY_SUITE
  fail "Security suite reports failed, skipped, or todo tests."
  exit 1
fi
record_pass DB_SECURITY_SUITE

# ---------------------------------------------------------------------------
# Typecheck, build, emitted import verification
# ---------------------------------------------------------------------------

printf '\n=== TYPECHECK ===\n'
npm run typecheck || {
  record_fail TYPECHECK
  exit 1
}
record_pass TYPECHECK

printf '\n=== BUILD ===\n'
npm run build || {
  record_fail BUILD
  exit 1
}
record_pass BUILD

printf '\n=== ESM IMPORT VERIFICATION ===\n'
new_tmp
ESM_LOG="$NEW_TMP_FILE"
if npm run 2>/dev/null | grep -Eiq 'verify.*(esm|import)|esm.*verify'; then
  # Use the repository's declared verifier script; do not infer success from
  # emitted JavaScript or generic build output.
  ESM_SCRIPT=""
  while IFS= read -r script_name; do
    if [[ "$script_name" =~ (verify.*(esm|import)|(esm|import).*verify) ]]; then
      ESM_SCRIPT="$script_name"
      break
    fi
  done < <(node -e "const p=require('./package.json'); for (const k of Object.keys(p.scripts||{})) console.log(k)")
  if [[ -n "$ESM_SCRIPT" ]]; then
    npm run "$ESM_SCRIPT" 2>&1 | tee "$ESM_LOG" || {
      record_fail ESM
      exit 1
    }
    grep -Eiq '[0-9]+ modules' "$ESM_LOG" || {
      record_fail ESM
      fail "ESM verifier did not report a module count."
      exit 1
    }
    grep -Eiq '[0-9]+ (relative )?imports' "$ESM_LOG" || {
      record_fail ESM
      fail "ESM verifier did not report relative-import count."
      exit 1
    }
    record_pass ESM
  else
    record_fail ESM
    fail "ESM verifier script could not be resolved."
    exit 1
  fi
else
  record_fail ESM
  fail "No declared ESM emitted-import verifier found."
  exit 1
fi

# ---------------------------------------------------------------------------
# Boot script static security assertions
# ---------------------------------------------------------------------------

printf '\n=== BOOT SCRIPT ===\n'
[[ -f "$BOOT_FILE" ]] || {
  record_fail BOOT_SCRIPT
  fail "Boot script missing: $BOOT_FILE"
  exit 1
}
bash -n "$BOOT_FILE" || {
  record_fail BOOT_SCRIPT
  exit 1
}

if grep -Eiq \
  'AUTH_DISABLED|SKIP_AUTH|Bearer[[:space:]]+[A-Za-z0-9._~-]{12,}|PRIVATE KEY|postgres(ql)?://[^[:space:]]+:[^@[:space:]]+@' \
  "$BOOT_FILE"; then
  record_fail BOOT_SCRIPT
  fail "Boot script contains a prohibited auth bypass or embedded credential pattern."
  exit 1
fi

grep -Fq 'u0_a427' "$BOOT_FILE" || {
  record_fail BOOT_SCRIPT
  fail "Boot script does not explicitly refuse administrator username u0_a427."
  exit 1
}
grep -Fq 'postgres' "$BOOT_FILE" || {
  record_fail BOOT_SCRIPT
  fail "Boot script does not explicitly refuse administrator username postgres."
  exit 1
}
record_pass BOOT_SCRIPT

# ---------------------------------------------------------------------------
# Real TCP service and MCP: do not fabricate external identity.
# ---------------------------------------------------------------------------

record_na REAL_TCP_SERVICE "No independently verified production authentication configuration was supplied to the release driver."
record_na HEALTH_LIVE "No legitimate production-authenticated TCP service was started."
record_na HEALTH_READY "No legitimate production-authenticated TCP service was started."
record_na LIVE_NEGATIVE_AUTH "No actual TCP service was started."
record_na LIVE_POSITIVE_MCP "No production-compatible bearer identity was supplied."
record_na CLEAN_SHUTDOWN "No script-owned TCP service process was started."

# ---------------------------------------------------------------------------
# Final cleanup assertions are performed by the EXIT trap.
# ---------------------------------------------------------------------------

if ! cleanup_resources; then
  exit 1
fi

printf '\n=== FINAL GIT INSPECTION ===\n'
git status --short --untracked-files=all
git diff --check
git diff --cached --check
record_pass GIT_DIFF

printf '\n=== RELEASE GATE MATRIX ===\n'
for gate in "${GATES[@]}"; do
  printf '%-26s %s\n' "$gate" "${G[$gate]}"
done

printf '\n=== FINAL CLASSIFICATION ===\n'

CORE_GATES=(
  POSTGRESQL
  RUNTIME_AUTH_7_OF_7
  MIGRATION_ORDER
  MIGRATION_00013
  MIGRATION_00014
  CONSTRAINED_LOGIN
  ROLE_SWITCHING
  NON_OWNER_RLS
  POOL_COMMIT
  POOL_ROLLBACK
  DB_SECURITY_SUITE
  TYPECHECK
  BUILD
  ESM
  BOOT_SCRIPT
  CLEANUP
  GIT_DIFF
)

LIVE_GATES=(
  REAL_TCP_SERVICE
  HEALTH_LIVE
  HEALTH_READY
  LIVE_NEGATIVE_AUTH
  LIVE_POSITIVE_MCP
  CLEAN_SHUTDOWN
)

SECURITY_GATES=(
  MIGRATION_00014
  CONSTRAINED_LOGIN
  ROLE_SWITCHING
  NON_OWNER_RLS
  POOL_COMMIT
  POOL_ROLLBACK
)

security_failure=0
coverage_missing=0
code_failure=0
runtime_auth_failure=0
other_failure=0
core_incomplete=0
live_failure=0
all_gates_pass=1

for gate in "${SECURITY_GATES[@]}"; do
  if [[ "${G[$gate]}" == "FAIL" ]]; then
    security_failure=1
  fi
done

if [[ "${G[MIGRATION_00013]}" == "FAIL" ||
      "${G[NON_OWNER_RLS]}" == "NOT EXECUTED" ||
      "${G[POOL_COMMIT]}" == "NOT EXECUTED" ||
      "${G[POOL_ROLLBACK]}" == "NOT EXECUTED" ||
      "${G[DB_SECURITY_SUITE]}" == "NOT EXECUTED" ]]; then
  coverage_missing=1
fi

if [[ "${G[RUNTIME_AUTH_7_OF_7]}" == "FAIL" ]]; then
  runtime_auth_failure=1
fi

for gate in TYPECHECK BUILD ESM BOOT_SCRIPT; do
  if [[ "${G[$gate]}" == "FAIL" ]]; then
    code_failure=1
  fi
done

for gate in "${CORE_GATES[@]}"; do
  status="${G[$gate]}"

  if [[ "$status" != "PASS" ]]; then
    all_gates_pass=0
  fi

  case "$status" in
    FAIL)
      case "$gate" in
        RUNTIME_AUTH_7_OF_7|TYPECHECK|BUILD|ESM|BOOT_SCRIPT|MIGRATION_00014|CONSTRAINED_LOGIN|ROLE_SWITCHING|NON_OWNER_RLS|POOL_COMMIT|POOL_ROLLBACK)
          ;;
        *)
          other_failure=1
          ;;
      esac
      ;;
    "NOT EXECUTED"|"NOT EXECUTABLE")
      core_incomplete=1
      ;;
  esac
done

for gate in "${LIVE_GATES[@]}"; do
  status="${G[$gate]}"

  if [[ "$status" != "PASS" ]]; then
    all_gates_pass=0
  fi

  if [[ "$status" == "FAIL" ]]; then
    live_failure=1
  fi
done

if (( security_failure )); then
  printf '%s\n' 'NOT READY - SECURITY DEFECT'
elif (( coverage_missing )); then
  printf '%s\n' 'NOT READY - MISSING REGRESSION COVERAGE'
elif (( runtime_auth_failure )); then
  printf '%s\n' 'NOT READY - RUNTIME AUTHENTICATION REGRESSION'
elif (( code_failure )); then
  printf '%s\n' 'NOT READY - CODE DEFECT'
elif (( other_failure || live_failure )); then
  printf '%s\n' 'NOT READY - RELEASE GATE FAILURE'
elif (( core_incomplete )); then
  printf '%s\n' 'NOT READY - INCOMPLETE VERIFICATION'
elif (( all_gates_pass )); then
  printf '%s\n' 'FUNCTIONING AND DELIVERED'
else
  printf '%s\n' 'CODE + DATABASE READY - EXTERNAL IDENTITY REQUIRED'
fi

printf '\n[INFO] No files were staged, committed, pushed, or reset.\n'
printf '[INFO] No unrelated process was signalled.\n'
exit 0
