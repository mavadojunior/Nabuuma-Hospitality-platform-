import { describe, expect, it, vi } from "vitest";
import type { PgExecutionContext } from "../src/infrastructure/database/transaction";
import { PgAuditRepository } from "../src/infrastructure/database/repositories/PgAuditRepository";
import {
  DomainConstraintError,
  TenantBoundaryViolationError,
} from "../src/domain/competency/errors";
import type { NewAuditEvent } from "../src/domain/competency/repositories/audit-contracts";

const organisationId = "11111111-1111-4111-8111-111111111111";
const actorUserId = "22222222-2222-4222-8222-222222222222";
const correlationId = "33333333-3333-4333-8333-333333333333";
const entityId = "44444444-4444-4444-8444-444444444444";

const event: NewAuditEvent = {
  organisationId,
  actorUserId,
  action: "ASSESSMENT_CREATED",
  entityType: "assessment",
  entityId,
  correlationId,
  outcome: "SUCCESS",
  metadata: { source: "unit-test" },
};

const returnedRow = {
  id: "55555555-5555-4555-8555-555555555555",
  organisation_id: organisationId,
  actor_user_id: actorUserId,
  action: event.action,
  entity_type: event.entityType,
  entity_id: entityId,
  occurred_at: "2026-10-09T10:00:00.000Z",
  correlation_id: correlationId,
  outcome: "SUCCESS" as const,
  metadata: { source: "unit-test" },
};

function makeHarness() {
  const query = vi.fn(async () => ({ rows: [returnedRow] }));

  const context = {
    client: { query },
    organisationId,
    security: {
      userId: actorUserId,
      organisationId,
      roles: ["TRAINER"],
      correlationId,
    },
  } as unknown as PgExecutionContext;

  return {
    repository: new PgAuditRepository(context),
    query,
  };
}

describe("PgAuditRepository", () => {
  it("inserts an audit event and maps the returned row", async () => {
    const h = makeHarness();

    const result = await h.repository.append(event);

    expect(result).toEqual({
      id: returnedRow.id,
      organisationId,
      actorUserId,
      action: event.action,
      entityType: event.entityType,
      entityId,
      occurredAt: "2026-10-09T10:00:00.000Z",
      correlationId,
      outcome: "SUCCESS",
      metadata: { source: "unit-test" },
    });

    expect(h.query).toHaveBeenCalledOnce();

    const [sql, values] = h.query.mock.calls[0] as unknown as [
      string,
      unknown[],
    ];

    expect(sql).toContain("INSERT INTO nabuuma.audit_events");
    expect(sql).toContain("RETURNING");
    expect(values).toEqual([
      organisationId,
      actorUserId,
      event.action,
      event.entityType,
      entityId,
      correlationId,
      "SUCCESS",
      JSON.stringify({ source: "unit-test" }),
    ]);
  });

  it("rejects an organisation mismatch before querying", async () => {
    const h = makeHarness();

    await expect(
      h.repository.append({
        ...event,
        organisationId: "66666666-6666-4666-8666-666666666666",
      }),
    ).rejects.toBeInstanceOf(TenantBoundaryViolationError);

    expect(h.query).not.toHaveBeenCalled();
  });

  it("rejects an actor mismatch before querying", async () => {
    const h = makeHarness();

    await expect(
      h.repository.append({
        ...event,
        actorUserId: "77777777-7777-4777-8777-777777777777",
      }),
    ).rejects.toBeInstanceOf(TenantBoundaryViolationError);

    expect(h.query).not.toHaveBeenCalled();
  });

  it("rejects a correlation ID that differs from the execution context", async () => {
    const h = makeHarness();

    await expect(
      h.repository.append({
        ...event,
        correlationId: "88888888-8888-4888-8888-888888888888",
      }),
    ).rejects.toBeInstanceOf(TenantBoundaryViolationError);

    expect(h.query).not.toHaveBeenCalled();
  });

  it("rejects a matching but non-UUID correlation ID before querying", async () => {
    const h = makeHarness();
    const nonUuid = "request-abc";

    const repository = new PgAuditRepository({
      client: { query: h.query },
      organisationId,
      security: {
        userId: actorUserId,
        organisationId,
        roles: ["TRAINER"],
        correlationId: nonUuid,
      },
    } as unknown as PgExecutionContext);

    await expect(
      repository.append({ ...event, correlationId: nonUuid }),
    ).rejects.toBeInstanceOf(DomainConstraintError);

    expect(h.query).not.toHaveBeenCalled();
  });

  it("maps a PostgreSQL check-constraint failure to a domain constraint error", async () => {
    const h = makeHarness();
    h.query.mockRejectedValue(
      Object.assign(new Error("check constraint failed"), {
        code: "23514",
      }),
    );

    await expect(h.repository.append(event)).rejects.toBeInstanceOf(
      DomainConstraintError,
    );
  });

  it("maps an RLS permission failure to a tenant boundary error", async () => {
    const h = makeHarness();
    h.query.mockRejectedValue(
      Object.assign(new Error("row-level security policy violation"), {
        code: "42501",
      }),
    );

    await expect(h.repository.append(event)).rejects.toBeInstanceOf(
      TenantBoundaryViolationError,
    );
  });
});
