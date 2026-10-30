#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

repo_root="${HOME}/Nabuuma-Hospitality-platform-"
env_file="${repo_root}/.env.production"
runtime_host="127.0.0.1"
runtime_port="3000"
base_url="http://${runtime_host}:${runtime_port}"
runtime_log=""
body_file=""
headers_file=""
server_pid=""
access_token=""

fail() {
  printf '[FAIL] %s\n' "$*" >&2
  exit 1
}

pass() {
  printf '[PASS] %s\n' "$*"
}

cleanup() {
  status=$?

  if test -n "$server_pid" &&
     kill -0 "$server_pid" 2>/dev/null
  then
    kill -TERM "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi

  access_token=""

  test -z "$runtime_log" || rm -f "$runtime_log"
  test -z "$body_file" || rm -f "$body_file"
  test -z "$headers_file" || rm -f "$headers_file"

  exit "$status"
}

trap cleanup EXIT INT TERM HUP

cd "$repo_root"

test -f "$env_file" ||
  fail ".env.production is missing"

test -x scripts/validate_runtime_env.sh ||
  fail "runtime environment validator is unavailable"

command -v curl >/dev/null 2>&1 ||
  fail "curl is unavailable"

command -v node >/dev/null 2>&1 ||
  fail "node is unavailable"

command -v pg_isready >/dev/null 2>&1 ||
  fail "pg_isready is unavailable"

scripts/validate_runtime_env.sh

set -a
# shellcheck disable=SC1091
. "$env_file"
set +a

for key in \
  DATABASE_URL \
  AUTH_JWT_ISSUER \
  AUTH_JWT_AUDIENCE \
  AUTH_JWKS_URI
do
  value="${!key:-}"

  test -n "$value" ||
    fail "${key} is empty"

  case "$value" in
    *CHANGE_ME*|*YOUR-PASSWORD*)
      fail "${key} contains placeholder data"
      ;;
  esac
done

runtime_log="$(
  mktemp "${PREFIX}/tmp/nabuuma-runtime.XXXXXX"
)"
body_file="$(
  mktemp "${PREFIX}/tmp/nabuuma-body.XXXXXX"
)"
headers_file="$(
  mktemp "${PREFIX}/tmp/nabuuma-headers.XXXXXX"
)"

printf '%s\n' "=== BUILD GATE ==="

npm run typecheck
npm run build
node --check dist/server.js

pass "TypeScript and production artefact"

printf '%s\n' "=== PROCESS STARTUP ==="

NODE_ENV=production \
HOST="$runtime_host" \
PORT="$runtime_port" \
SHUTDOWN_TIMEOUT_MS=5000 \
node dist/server.js >"$runtime_log" 2>&1 &

server_pid=$!
live=0

for attempt in 1 2 3 4 5 6 7 8 9 10
do
  if ! kill -0 "$server_pid" 2>/dev/null
  then
    printf '%s\n' \
      "[FAIL] runtime exited during startup" >&2
    tail -n 100 "$runtime_log" >&2
    exit 1
  fi

  if curl \
    --silent \
    --show-error \
    --connect-timeout 2 \
    --max-time 5 \
    "${base_url}/health/live" \
    >/dev/null 2>&1
  then
    live=1
    break
  fi

  sleep 1
done

test "$live" -eq 1 || {
  printf '%s\n' \
    "[FAIL] liveness deadline exceeded" >&2
  tail -n 100 "$runtime_log" >&2
  exit 1
}

pass "production process startup"

live_body="$(
  curl \
    --fail \
    --silent \
    --show-error \
    --connect-timeout 2 \
    --max-time 5 \
    "${base_url}/health/live"
)"

test "$live_body" = '{"status":"LIVE"}' ||
  fail "unexpected liveness response"

pass "/health/live"

ready_body="$(
  curl \
    --fail \
    --silent \
    --show-error \
    --connect-timeout 2 \
    --max-time 5 \
    "${base_url}/health/ready"
)"

test "$ready_body" = '{"status":"READY"}' ||
  fail "unexpected readiness response"

pass "/health/ready"

printf '%s\n' "=== AUTHENTICATION NEGATIVE GATES ==="

unauthenticated_status="$(
  curl \
    --silent \
    --show-error \
    --connect-timeout 2 \
    --max-time 5 \
    --output "$body_file" \
    --write-out '%{http_code}' \
    "${base_url}/api/v1/academy/courses"
)"

test "$unauthenticated_status" = "401" || {
  printf '[FAIL] missing-token HTTP status: %s\n' \
    "$unauthenticated_status" >&2
  head -c 4096 "$body_file" >&2
  printf '\n' >&2
  exit 1
}

node - "$body_file" <<'NODE'
const fs = require("node:fs");

const path = process.argv[2];
const body = JSON.parse(fs.readFileSync(path, "utf8"));

if (
  body.code !== "UNAUTHENTICATED" ||
  body.message !== "Authentication required."
) {
  throw new Error(
    "Unexpected missing-token response contract",
  );
}
NODE

pass "missing Authorization header rejected with HTTP 401"

malformed_status="$(
  curl \
    --silent \
    --show-error \
    --connect-timeout 2 \
    --max-time 5 \
    --output "$body_file" \
    --write-out '%{http_code}' \
    --header 'Authorization: Bearer malformed' \
    "${base_url}/api/v1/academy/courses"
)"

test "$malformed_status" = "401" || {
  printf '[FAIL] malformed-token HTTP status: %s\n' \
    "$malformed_status" >&2
  head -c 4096 "$body_file" >&2
  printf '\n' >&2
  exit 1
}

pass "malformed Bearer credential rejected with HTTP 401"

printf '%s\n' "=== AUTHENTICATED READ-ONLY GATE ==="

if test -n "${E2E_ACCESS_TOKEN:-}"
then
  access_token="$E2E_ACCESS_TOKEN"
else
  read -rsp 'RAW ACCESS TOKEN: ' access_token
  printf '\n'
fi

access_token="${access_token#Bearer }"
access_token="$(
  printf '%s' "$access_token" |
    tr -d '\r\n'
)"

test -n "$access_token" ||
  fail "access token is empty"

if ! TOKEN="$access_token" node --input-type=module <<'NODE'
import { createRemoteJWKSet, jwtVerify } from "jose";

const token = process.env.TOKEN ?? "";
const issuer = (process.env.AUTH_JWT_ISSUER ?? "").replace(/\/$/, "");
const audience = process.env.AUTH_JWT_AUDIENCE ?? "";
const jwksUri = process.env.AUTH_JWKS_URI ?? "";

const acceptedAlgorithms = ["RS256", "ES256"];
const acceptedRoles = new Set([
  "LEARNER",
  "PROFESSIONAL",
  "TRAINER",
  "ORGANISATION_MANAGER",
  "ORGANISATION_OWNER",
  "PLATFORM_ADMIN",
]);

function requireHttpsUrl(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} is not a valid URL`);
  }

  if (url.protocol !== "https:") {
    throw new Error(`${name} must use HTTPS`);
  }
  return url;
}

try {
  if (!token) {
    throw new Error("access token is empty");
  }
  if (!issuer || !audience) {
    throw new Error("JWT issuer or audience configuration is empty");
  }

  const jwksUrl = requireHttpsUrl(jwksUri, "AUTH_JWKS_URI");
  requireHttpsUrl(issuer, "AUTH_JWT_ISSUER");

  const JWKS = createRemoteJWKSet(jwksUrl);

  const { payload } = await jwtVerify(token, JWKS, {
    issuer,
    audience,
    algorithms: acceptedAlgorithms,
    requiredClaims: [
      "sub",
      "exp",
      "iat",
      "organisation_id",
      "roles",
    ],
  });

  const checks = {
    signature: true,
    algorithm: true,
    issuer: payload.iss === issuer,
    audience: Array.isArray(payload.aud)
      ? payload.aud.includes(audience)
      : payload.aud === audience,
    subject:
      typeof payload.sub === "string" &&
      payload.sub.trim().length > 0,
    issuedAt:
      typeof payload.iat === "number" &&
      Number.isFinite(payload.iat),
    expiry:
      typeof payload.exp === "number" &&
      payload.exp > Math.floor(Date.now() / 1000),
    organisation:
      typeof payload.organisation_id === "string" &&
      payload.organisation_id.trim().length > 0,
    roles:
      Array.isArray(payload.roles) &&
      payload.roles.length > 0 &&
      payload.roles.every(
        (role) =>
          typeof role === "string" &&
          acceptedRoles.has(role),
      ),
  };

  for (const [name, passed] of Object.entries(checks)) {
    console.log(`[${passed ? "PASS" : "FAIL"}] token ${name}`);
  }

  if (!Object.values(checks).every(Boolean)) {
    process.exitCode = 2;
  }
} catch (error) {
  console.error(
    `[FAIL] JWT cryptographic verification (${error.code ?? error.name ?? "verification_error"})`,
  );
  process.exitCode = 2;
}
NODE
then
  fail "JWT preflight failed; authenticated request was not sent"
fi

set +e

authenticated_status="$(
  curl \
    --silent \
    --show-error \
    --request GET \
    --connect-timeout 5 \
    --max-time 20 \
    --dump-header "$headers_file" \
    --output "$body_file" \
    --write-out '%{http_code}' \
    --header "Authorization: Bearer ${access_token}" \
    --header 'Accept: application/json' \
    "${base_url}/api/v1/academy/courses"
)"

curl_status=$?

set -e
access_token=""
unset E2E_ACCESS_TOKEN 2>/dev/null || true

printf 'curl_exit=%s\n' "$curl_status"
printf 'http_status=%s\n' "$authenticated_status"
printf 'body_bytes=%s\n' "$(wc -c <"$body_file")"

if test "$curl_status" -ne 0
then
  printf '%s\n' \
    "[FAIL] authenticated request transport failure" >&2
  sed -n '1,20p' "$headers_file" >&2
  head -c 4096 "$body_file" >&2
  printf '\n' >&2
  exit 1
fi

case "$authenticated_status" in
  200)
    ;;
  401)
    printf '%s\n' \
      "[FAIL] JWT rejected by authentication" >&2
    ;;
  403)
    printf '%s\n' \
      "[FAIL] identity authenticated but forbidden" >&2
    ;;
  *)
    printf '[FAIL] unexpected HTTP status: %s\n' \
      "$authenticated_status" >&2
    ;;
esac

test "$authenticated_status" = "200" || {
  printf '%s\n' "=== RESPONSE HEADERS ===" >&2
  sed -n '1,20p' "$headers_file" >&2

  printf '%s\n' "=== RESPONSE BODY ===" >&2
  head -c 4096 "$body_file" >&2
  printf '\n' >&2

  printf '%s\n' "=== SERVER LOG ===" >&2
  tail -n 100 "$runtime_log" >&2
  exit 1
}

node - "$body_file" <<'NODE'
const fs = require("node:fs");

const body = JSON.parse(
  fs.readFileSync(process.argv[2], "utf8"),
);

if (!Array.isArray(body.data)) {
  throw new Error(
    "Authenticated response data must be an array",
  );
}

console.log(
  `[PASS] course response: ${body.data.length} item(s)`,
);
NODE

pass "Supabase JWT verification"
pass "authenticated Academy HTTP route"
pass "PostgreSQL-backed read"

printf '%s\n' "=== GRACEFUL SHUTDOWN ==="

kill -TERM "$server_pid"

if ! wait "$server_pid"
then
  printf '%s\n' \
    "[FAIL] runtime returned non-zero after SIGTERM" >&2
  tail -n 100 "$runtime_log" >&2
  exit 1
fi

server_pid=""

pass "graceful SIGTERM"

printf '%s\n' "=== REPOSITORY INTEGRITY ==="

git diff --check

test -z "$(git status --porcelain)" || {
  printf '%s\n' \
    "[FAIL] verification mutated the repository" >&2
  git status --short >&2
  exit 1
}

pass "repository remained clean"

printf '%s\n' \
  "========================================" \
  "NABUUMA READ-ONLY E2E: PASS" \
  "========================================"
