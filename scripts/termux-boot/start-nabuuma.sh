#!/data/data/com.termux/files/usr/bin/bash
set -Eeuo pipefail

PROJECT="$HOME/Nabuuma-Hospitality-platform-"
PGDATA="$HOME/nabuuma-pg-test-recovery-copy"
RUN_DIR="$HOME/.local/run/nabuuma"
LOG_DIR="$HOME/.local/log/nabuuma"
ENV_FILE="$HOME/.config/nabuuma/runtime.env"

DB_PORT="55433"
API_PORT="3000"
PG_LOG="$LOG_DIR/postgres.log"
API_LOG="$LOG_DIR/api.log"
API_PID="$RUN_DIR/api.pid"

mkdir -p "$RUN_DIR" "$LOG_DIR"
chmod 700 "$RUN_DIR" "$LOG_DIR"

exec >> "$LOG_DIR/boot.log" 2>&1

echo
echo "=== Nabuuma boot: $(date -Is) ==="

fail() {
  echo "[ERROR] $*" >&2
  exit 1
}

command -v pg_ctl >/dev/null 2>&1 || fail "pg_ctl unavailable"
command -v pg_isready >/dev/null 2>&1 || fail "pg_isready unavailable"
command -v npm >/dev/null 2>&1 || fail "npm unavailable"

test -d "$PGDATA" || fail "Recovery-copy data directory missing"
test -f "$PROJECT/package.json" || fail "Project directory invalid"

echo "[1/4] Starting isolated PostgreSQL recovery copy"

if pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
  echo "[INFO] PostgreSQL is already running."
else
  pg_ctl -D "$PGDATA" \
    -l "$PG_LOG" \
    -o "-p $DB_PORT -c listen_addresses=127.0.0.1" \
    -w -t 60 start \
    || fail "PostgreSQL startup failed"
fi

echo "[2/4] Checking PostgreSQL readiness"

ready=0
for attempt in $(seq 1 30); do
  if pg_isready -h 127.0.0.1 -p "$DB_PORT" -d nabuuma_test >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done

test "$ready" -eq 1 || fail "PostgreSQL did not become ready"

echo "[OK] PostgreSQL ready on 127.0.0.1:$DB_PORT"

echo "[3/4] Checking API runtime configuration"

if [ ! -f "$ENV_FILE" ]; then
  echo "[SKIP] API not started: runtime.env has not been configured."
  echo "[INFO] PostgreSQL remains available for local development."
  exit 0
fi

# This file is a private, user-maintained shell environment file.
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

: "${DATABASE_URL:?DATABASE_URL is required in runtime.env}"

node --input-type=module <<'NODE' || fail "Unsafe or invalid DATABASE_URL"
const raw = process.env.DATABASE_URL;
let parsed;

try {
  parsed = new URL(raw);
} catch {
  console.error("DATABASE_URL is not a valid URL.");
  process.exit(1);
}

if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
  console.error("DATABASE_URL must use PostgreSQL.");
  process.exit(1);
}

const username = decodeURIComponent(parsed.username).toLowerCase();

if (["u0_a427", "postgres"].includes(username)) {
  console.error("Refusing to run the API with a PostgreSQL superuser.");
  process.exit(1);
}

if (parsed.hostname !== "127.0.0.1" || parsed.port !== "55433") {
  console.error("DATABASE_URL must target 127.0.0.1:55433.");
  process.exit(1);
}

if (!parsed.pathname || parsed.pathname === "/") {
  console.error("DATABASE_URL must specify a database.");
  process.exit(1);
}
NODE

echo "[4/4] Building and starting Nabuuma API"

cd "$PROJECT" || fail "Cannot enter project directory"

npm run build || fail "Production build failed"

if [ -f "$API_PID" ]; then
  old_pid="$(cat "$API_PID" 2>/dev/null || true)"
  if [[ "$old_pid" =~ ^[0-9]+$ ]] && kill -0 "$old_pid" 2>/dev/null; then
    echo "[INFO] API process already running: PID $old_pid"
    exit 0
  fi
  rm -f "$API_PID"
fi

if curl -fsS "http://127.0.0.1:$API_PORT/health/live" >/dev/null 2>&1; then
  echo "[INFO] An API is already responding on port $API_PORT."
  exit 0
fi

(
  export HOST="127.0.0.1"
  export PORT="$API_PORT"
  export NODE_ENV="production"
  exec npm start
) >> "$API_LOG" 2>&1 &

api_pid=$!
printf '%s\n' "$api_pid" > "$API_PID"

for attempt in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$API_PORT/health/live" >/dev/null 2>&1; then
    echo "[OK] API is live on 127.0.0.1:$API_PORT"
    exit 0
  fi

  if ! kill -0 "$api_pid" 2>/dev/null; then
    rm -f "$API_PID"
    fail "API process exited; inspect $API_LOG"
  fi

  sleep 2
done

fail "API health check timed out; inspect $API_LOG"
