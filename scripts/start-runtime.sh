#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

PROJECT="$HOME/Nabuuma-Hospitality-platform-"
ENV_FILE="$HOME/.config/nabuuma/runtime.env"

fail() {
  printf '[ERROR] %s\n' "$*" >&2
  exit 1
}

[[ -f "$ENV_FILE" ]] || fail "Private runtime configuration is missing: ~/.config/nabuuma/runtime.env"
[[ -r "$ENV_FILE" ]] || fail "Private runtime configuration is not readable."
[[ ! -L "$ENV_FILE" ]] || fail "Private runtime configuration must not be a symlink."
[[ -f "$PROJECT/dist/server.js" ]] || fail "Production build is missing. Run npm run build first."

runtime_owner="$(stat -c '%u' "$ENV_FILE")"
runtime_mode="$(stat -c '%a' "$ENV_FILE")"
[[ "$runtime_owner" == "$(id -u)" ]] || fail "Private runtime configuration must be owned by the current Termux user."
[[ "$runtime_mode" =~ ^[0-7]{3,4}$ ]] || fail "Could not validate private runtime file permissions."
(( (8#$runtime_mode & 077) == 0 )) || fail "Private runtime configuration must not grant group or other access."

# Source only the private runtime configuration.
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${AUTH_JWT_ISSUER:?AUTH_JWT_ISSUER is required}"
: "${AUTH_JWT_AUDIENCE:?AUTH_JWT_AUDIENCE is required}"
: "${AUTH_JWKS_URI:?AUTH_JWKS_URI is required}"

node --input-type=module <<'NODE' || fail "Runtime target validation failed"
const raw = process.env.DATABASE_URL;
let url;
try { url = new URL(raw); } catch { console.error("DATABASE_URL is invalid."); process.exit(1); }
if (!["postgres:", "postgresql:"].includes(url.protocol)) { console.error("DATABASE_URL must use PostgreSQL."); process.exit(1); }
const user = decodeURIComponent(url.username);
const db = decodeURIComponent(url.pathname.replace(/^\//, ""));
if (url.hostname !== "127.0.0.1" || url.port !== "55433" || db !== "nabuuma_rls_test" || user !== "nabuuma_runtime") {
  console.error("Refusing startup: DATABASE_URL must target the approved recovery-copy host, port, database, and least-privilege role.");
  process.exit(1);
}
if (url.search || url.hash) { console.error("DATABASE_URL query parameters and fragments are not permitted."); process.exit(1); }
for (const name of ["AUTH_JWT_ISSUER", "AUTH_JWKS_URI"]) {
  try { const value = new URL(process.env[name]); if (value.protocol !== "https:") throw new Error(); }
  catch { console.error(`${name} must be a valid HTTPS URL.`); process.exit(1); }
}
if (!process.env.AUTH_JWT_AUDIENCE.trim()) { console.error("AUTH_JWT_AUDIENCE cannot be empty."); process.exit(1); }
NODE

export HOST="127.0.0.1"
export PORT="3000"
export NODE_ENV="production"
cd "$PROJECT"
exec node dist/server.js
