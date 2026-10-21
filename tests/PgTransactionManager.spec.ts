import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import {
  PgTransactionManager,
  type PgExecutionContext,
} from "../src/infrastructure/database/transaction";
import {
  createSecurityContext,
  type TokenClaims,
} from "../src/infrastructure/security/security";

const claims: TokenClaims = {
  subject: "user-123",
  organisationId: "org-456",
  roles: ["TRAINER"],
  scopeOrganisationIds: ["org-789"],
};

const security = createSecurityContext(claims, "33333333-3333-4333-8333-333333333333");

function makeHarness() {
  const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({}));
  const release = vi.fn();
  const client = {
    query,
    release,
  } as unknown as PoolClient;

  const connect = vi.fn(async () => client);
  const pool = { connect } as unknown as Pool;
  const manager = new PgTransactionManager(pool);

  return { manager, pool, connect, client, query, release };
}

describe("PgTransactionManager", () => {
  it("sets transaction-local identity, passes security context, commits, and releases", async () => {
    const h = makeHarness();
    let received: PgExecutionContext | undefined;

    const result = await h.manager.withTransaction(security, async (context) => {
      received = context;
      return "completed";
    });

    expect(result).toBe("completed");
    expect(h.connect).toHaveBeenCalledOnce();
    expect(h.query.mock.calls[0]?.[0]).toBe("BEGIN");

    expect(h.query.mock.calls[1]?.[0]).toBe("SET LOCAL ROLE nabuuma_app");
    const settingsCall = h.query.mock.calls[2];
    expect(settingsCall?.[0]).toContain(
      "set_config('app.user_id', $1, true)",
    );
    expect(settingsCall?.[0]).toContain(
      "set_config('app.organisation_id', $2, true)",
    );
    expect(settingsCall?.[1]).toEqual(["user-123", "org-456"]);

    expect(received?.client).toBe(h.client);
    expect(received?.security).toBe(security);
    expect(received?.organisationId).toBe("org-456");
    expect(h.query.mock.calls[3]?.[0]).toBe("COMMIT");
    expect(h.release).toHaveBeenCalledOnce();
  });

  it("rolls back and releases when the callback fails", async () => {
    const h = makeHarness();
    const failure = new Error("callback failed");

    await expect(
      h.manager.withTransaction(security, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(h.query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      "SET LOCAL ROLE nabuuma_app",
      expect.stringContaining("set_config('app.user_id'"),
      "ROLLBACK",
    ]);
    expect(h.release).toHaveBeenCalledOnce();
  });

  it("preserves the original failure when rollback also fails", async () => {
    const rollbackFailure = new Error("rollback failed");
    const originalFailure = new Error("work failed");
    const h = makeHarness();

    h.query.mockImplementation(async (sql: string) => {
      if (sql === "ROLLBACK") {
        throw rollbackFailure;
      }
      return {};
    });

    await expect(
      h.manager.withTransaction(security, async () => {
        throw originalFailure;
      }),
    ).rejects.toBe(originalFailure);

    expect(h.release).toHaveBeenCalledOnce();
  });

  it("releases the client when BEGIN fails without attempting rollback", async () => {
    const failure = new Error("begin failed");
    const h = makeHarness();

    h.query.mockImplementation(async (sql: string) => {
      if (sql === "BEGIN") {
        throw failure;
      }
      return {};
    });

    await expect(
      h.manager.withTransaction(security, async () => "unreachable"),
    ).rejects.toBe(failure);

    expect(h.query).toHaveBeenCalledOnce();
    expect(h.release).toHaveBeenCalledOnce();
  });

  it("rolls back and releases when switching to the application role fails", async () => {
    const failure = new Error("role switch failed");
    const h = makeHarness();
    h.query.mockImplementation(async (sql: string) => {
      if (sql === "SET LOCAL ROLE nabuuma_app") throw failure;
      return {};
    });
    await expect(h.manager.withTransaction(security, async () => "unreachable")).rejects.toBe(failure);
    expect(h.query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      "SET LOCAL ROLE nabuuma_app",
      "ROLLBACK",
    ]);
    expect(h.release).toHaveBeenCalledOnce();
  });

  it("rolls back and releases when setting the RLS context fails", async () => {
    const failure = new Error("RLS context setup failed");
    const h = makeHarness();

    h.query.mockImplementation(async (sql: string) => {
      if (sql.includes("set_config")) {
        throw failure;
      }
      return {};
    });

    await expect(
      h.manager.withTransaction(security, async () => "unreachable"),
    ).rejects.toBe(failure);

    expect(h.query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      "SET LOCAL ROLE nabuuma_app",
      expect.stringContaining("set_config('app.user_id'"),
      "ROLLBACK",
    ]);
    expect(h.release).toHaveBeenCalledOnce();
  });
});
