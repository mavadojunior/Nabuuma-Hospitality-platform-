#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

readonly REPO_ROOT="${HOME}/Nabuuma-Hospitality-platform-"
readonly ENV_FILE="${REPO_ROOT}/.env.production"
readonly PG_HOST="127.0.0.1"
readonly PG_PORT="55432"
readonly REQUIRED_KEYS=(
  "DATABASE_URL"
  "AUTH_JWT_ISSUER"
  "AUTH_JWT_AUDIENCE"
  "AUTH_JWKS_URI"
)

die() {
  printf '[FAIL] %s\n' "$*" >&2
  exit 1
}

pass() {
  printf '[PASS] %s\n' "$*"
}

cd "$REPO_ROOT"

test -f "$ENV_FILE" ||
  die ".env.production does not exist"

command -v pg_isready >/dev/null 2>&1 ||
  die "pg_isready is not installed"

for key in "${REQUIRED_KEYS[@]}"; do
  count="$(grep -c "^${key}=" "$ENV_FILE" || true)"

  test "$count" -eq 1 ||
    die "${key} must occur exactly once"
done

while IFS='=' read -r key value || test -n "${key:-}"; do
  case "$key" in
    ''|'#'*)
      continue
      ;;
    DATABASE_URL|AUTH_JWT_ISSUER|AUTH_JWT_AUDIENCE|AUTH_JWKS_URI)
      printf -v "$key" '%s' "$value"
      ;;
    *)
      die "unsupported key in .env.production: ${key}"
      ;;
  esac
done < "$ENV_FILE"

for key in "${REQUIRED_KEYS[@]}"; do
  value="${!key:-}"

  test -n "$value" ||
    die "${key} is empty"

  case "$value" in
    *CHANGE_ME*)
      die "${key} contains an unresolved CHANGE_ME placeholder"
      ;;
  esac

  pass "${key}: configured (${#value} characters)"
done

case "$DATABASE_URL" in
  postgresql://*@127.0.0.1:55432/*|postgres://*@127.0.0.1:55432/*)
    pass "DATABASE_URL: targets 127.0.0.1:55432"
    ;;
  *)
    die "DATABASE_URL must target 127.0.0.1:55432"
    ;;
esac

case "$AUTH_JWT_ISSUER" in
  https://*)
    pass "AUTH_JWT_ISSUER: HTTPS"
    ;;
  *)
    die "AUTH_JWT_ISSUER must use HTTPS"
    ;;
esac

case "$AUTH_JWKS_URI" in
  https://*)
    pass "AUTH_JWKS_URI: HTTPS"
    ;;
  *)
    die "AUTH_JWKS_URI must use HTTPS"
    ;;
esac

printf '%s\n' '=== POSTGRESQL READINESS ==='

if pg_isready \
  --host="$PG_HOST" \
  --port="$PG_PORT" \
  --timeout=3 \
  --quiet
then
  pass "PostgreSQL ${PG_HOST}:${PG_PORT}: accepting connections"
else
  status=$?
  die "PostgreSQL readiness failed with exit status ${status}"
fi

printf '%s\n' '=== VALIDATION REPORT ==='
printf '%-24s %s\n' "DATABASE_URL" "VALID"
printf '%-24s %s\n' "AUTH_JWT_ISSUER" "VALID"
printf '%-24s %s\n' "AUTH_JWT_AUDIENCE" "VALID"
printf '%-24s %s\n' "AUTH_JWKS_URI" "VALID"
printf '%-24s %s\n' "POSTGRESQL_55432" "READY"

printf '%s\n' '[PASS] production runtime environment validated'
