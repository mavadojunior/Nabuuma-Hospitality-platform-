#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ROOT="$HOME/Nabuuma-Hospitality-platform-"
cd "$ROOT"

fail() { printf 'STOPPED: %s\n' "$1" >&2; exit 1; }

[ "$(git rev-parse --show-toplevel)" = "$ROOT" ] || fail "Unexpected repository root."
[ "$(git branch --show-current)" = "main" ] || fail "Expected main branch."

EXPECTED="$(printf '%s\n' 
'?? db/migrations/00003_create_audit_events_ledger.sql' 
'?? db/migrations/00005_create_audit_events_ledger.sql' 
'?? nabuuma-audit-patch.sh' 
'?? src/infrastructure/security/security.ts.pre-security-context' | sort)"
ACTUAL="$(git status --short | sort)"
[ "$ACTUAL" = "$EXPECTED" ] || fail "Working tree changed. Inspect git status --short."

for f in 
src/domain/competency/repositories/audit-contracts.ts 
src/infrastructure/database/repositories/PgAuditRepository.ts 
tests/PgAuditRepository.spec.ts
do
[ ! -e "$f" ] || fail "Refusing to overwrite $f"
done

grep -Fq 'operation: "competency" | "telemetry" | "assessment",' 
src/infrastructure/database/error-mapping.ts ||
fail "Unexpected error-mapping signature."
grep -Fq 'export * from "./repositories/PgAssessmentRepository";' 
src/infrastructure/database/index.ts ||
fail "Unexpected database export file."

Back up only the two tracked files that this patch will edit.

The backup is created outside the repository and is never overwritten.

BACKUP="$HOME/nabuuma-audit-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -m 700 "$BACKUP"
cp src/infrastructure/database/error-mapping.ts "$BACKUP/error-mapping.ts"
cp src/infrastructure/database/index.ts "$BACKUP/index.ts"

mkdir -p src/domain/competency/repositories 
src/infrastructure/database/repositories tests

cat > src/domain/competency/repositories/audit-contracts.ts <<'EOF'
export type AuditOutcome = "SUCCESS" | "FAILURE";

export interface AuditEvent {
readonly id: string;
readonly organisationId: string;
readonly actorUserId: string;
readonly action: string;
readonly entityType: string;
readonly entityId: string;
readonly occurredAt: string;
readonly correlationId: string;
readonly outcome: AuditOutcome;
readonly metadata: Readonly<Record<string, unknown>>;
}

export interface NewAuditEvent {
readonly organisationId: string;
readonly actorUserId: string;
readonly action: string;
readonly entityType: string;
readonly entityId: string;
readonly correlationId: string;
readonly outcome: AuditOutcome;
readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AuditRepository {
append(event: NewAuditEvent): Promise<AuditEvent>;
}
EOF

cat > src/infrastructure/database/repositories/PgAuditRepository.ts <<'EOF'
import { randomUUID } from "node:crypto";
import type {
AuditEvent,
AuditRepository,
NewAuditEvent,
} from "../../../domain/competency/repositories/audit-contracts";
import type { PgExecutionContext } from "../transaction";
import { mapPgError } from "../error-mapping";

interface AuditRow {
id: string;
organisation_id: string;
actor_user_id: string;
action: string;
entity_type: string;
entity_id: string;
occurred_at: Date | string;
correlation_id: string;
outcome: "SUCCESS" | "FAILURE";
metadata: Record<string, unknown>;
}

const UUID_PATTERN =
/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireUuid(value: string, field: string): void {
if (!UUID_PATTERN.test(value)) {
throw new TypeError("${field} must be a valid UUID.");
}
}

function requireText(value: string, field: string, max: number): void {
if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
throw new TypeError("${field} must be non-empty and at most ${max} characters.");
}
}

function mapRow(row: AuditRow): AuditEvent {
const metadata =
row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
? row.metadata
: {};

return {
id: row.id,
organisationId: row.organisation_id,
actorUserId: row.actor_user_id,
action: row.action,
entityType: row.entity_type,
entityId: row.entity_id,
occurredAt: row.occurred_at instanceof Date
? row.occurred_at.toISOString()
: row.occurred_at,
correlationId: row.correlation_id,
outcome: row.outcome,
metadata,
};
}

/**

* Append-only audit adapter. Uses the caller's transaction-scoped client;
* it never creates a separate connection or commits independently.
  */
  export class PgAuditRepository implements AuditRepository {
  constructor(private readonly context: PgExecutionContext) {}

async append(event: NewAuditEvent): Promise<AuditEvent> {
requireUuid(event.organisationId, "organisationId");
requireUuid(event.actorUserId, "actorUserId");
requireUuid(event.entityId, "entityId");
requireUuid(event.correlationId, "correlationId");
requireText(event.action, "action", 100);
requireText(event.entityType, "entityType", 50);

if (event.organisationId !== this.context.organisationId) {
  throw new TypeError("Audit organisation does not match the database context.");
}
if (event.actorUserId !== this.context.security.userId) {
  throw new TypeError("Audit actor does not match the authenticated user.");
}
if (event.outcome !== "SUCCESS" && event.outcome !== "FAILURE") {
  throw new TypeError("Audit outcome must be SUCCESS or FAILURE.");
}

const metadata = event.metadata ?? {};
if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
  throw new TypeError("Audit metadata must be a JSON object.");
}

try {
  const result = await this.context.client.query<AuditRow>(
    `INSERT INTO nabuuma.audit_events (
       id, organisation_id, actor_user_id, action, entity_type,
       entity_id, correlation_id, outcome, metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     RETURNING id, organisation_id, actor_user_id, action, entity_type,
               entity_id, occurred_at, correlation_id, outcome, metadata`,
    [
      randomUUID(),
      event.organisationId,
      event.actorUserId,
      event.action,
      event.entityType,
      event.entityId,
      event.correlationId,
      event.outcome,
      JSON.stringify(metadata),
    ],
  );

  const row = result.rows[0];
  if (!row) throw new Error("Audit INSERT returned no row.");
  return mapRow(row);
} catch (error) {
  throw mapPgError(error, "audit");
}

}
}
EOF

cat > tests/PgAuditRepository.spec.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import type { PgExecutionContext } from "../src/infrastructure/database/transaction";
import { PgAuditRepository } from "../src/infrastructure/database/repositories/PgAuditRepository";
import type { SecurityContext } from "../src/infrastructure/security/security";

const userId = "11111111-1111-4111-8111-111111111111";
const organisationId = "22222222-2222-4222-8222-222222222222";
const entityId = "33333333-3333-4333-8333-333333333333";
const correlationId = "44444444-4444-4444-8444-444444444444";

function harness() {
const query = vi.fn(async () => ({
rows: [{
id: "55555555-5555-4555-8555-555555555555",
organisation_id: organisationId,
actor_user_id: userId,
action: "COMPETENCY_TRANSITION",
entity_type: "learner_competency",
entity_id: entityId,
occurred_at: new Date("2026-10-01T10:00:00.000Z"),
correlation_id: correlationId,
outcome: "SUCCESS" as const,
metadata: { state: "PRACTICE" },
}],
}));
const security = {
userId, organisationId, roles: ["TRAINER"], correlationId,
} as SecurityContext;
const context = {
client: { query } as unknown as PoolClient,
security,
organisationId,
} as PgExecutionContext;
return { repository: new PgAuditRepository(context), query };
}

describe("PgAuditRepository", () => {
it("inserts using the transaction-scoped client", async () => {
const { repository, query } = harness();
const event = await repository.append({
organisationId, actorUserId: userId,
action: "COMPETENCY_TRANSITION",
entityType: "learner_competency", entityId,
correlationId, outcome: "SUCCESS",
metadata: { state: "PRACTICE" },
});

expect(query).toHaveBeenCalledOnce();
expect(query.mock.calls[0]?.[0]).toContain("INSERT INTO nabuuma.audit_events");
expect(event.organisationId).toBe(organisationId);
expect(event.actorUserId).toBe(userId);
expect(event.metadata).toEqual({ state: "PRACTICE" });

});

it("rejects a different organisation before querying", async () => {
const { repository, query } = harness();
await expect(repository.append({
organisationId: "66666666-6666-4666-8666-666666666666",
actorUserId: userId, action: "TEST", entityType: "test",
entityId, correlationId, outcome: "SUCCESS",
})).rejects.toThrow(/organisation does not match/i);
expect(query).not.toHaveBeenCalled();
});

it("rejects an actor different from the authenticated user", async () => {
const { repository, query } = harness();
await expect(repository.append({
organisationId, actorUserId: "66666666-6666-4666-8666-666666666666",
action: "TEST", entityType: "test", entityId,
correlationId, outcome: "SUCCESS",
})).rejects.toThrow(/actor does not match/i);
expect(query).not.toHaveBeenCalled();
});

it("rejects an invalid correlation UUID before querying", async () => {
const { repository, query } = harness();
await expect(repository.append({
organisationId, actorUserId: userId, action: "TEST",
entityType: "test", entityId, correlationId: "request-abc",
outcome: "SUCCESS",
})).rejects.toThrow(/correlationId must be a valid UUID/i);
expect(query).not.toHaveBeenCalled();
});
});
EOF

Update the operation union without replacing the rest of the mapper.

python - <<'PY'
from pathlib import Path
p = Path("src/infrastructure/database/error-mapping.ts")
s = p.read_text()
old = 'operation: "competency" | "telemetry" | "assessment",'
new = 'operation: "competency" | "telemetry" | "assessment" | "audit",'
if s.count(old) != 1:
raise SystemExit("STOPPED: error-mapping signature changed unexpectedly.")
p.write_text(s.replace(old, new, 1))
PY

printf '\nexport * from "./repositories/PgAuditRepository";\n' \

««src/infrastructure/database/index.ts»»

printf '\nPatch created. No migrations or database writes were run.\n'
printf 'Backup directory: %s\n' "$BACKUP"
git status --short
git diff -- src/infrastructure/database/error-mapping.ts src/infrastructure/database/index.ts
