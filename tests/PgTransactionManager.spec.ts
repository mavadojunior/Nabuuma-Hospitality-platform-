import { describe, it, expect, beforeEach, vi } from "vitest";
import type { PoolClient } from "pg";
import { PgTransactionManager } from "../src/infrastructure/database/transaction";
import type { TokenClaims } from "../src/infrastructure/security/security";

interface MockedPoolClient extends Partial<PoolClient> {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
}

interface TestHarness {
  manager: PgTransactionManager;
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
}

function makeHarness(): TestHarness {
  const query = vi.fn(async () => ({}));
  const release = vi.fn(async () => {});

  const client: MockedPoolClient = {
    query,
    release,
  };

  const pool = {
    connect: vi.fn(async () => client),
  };

  const manager = new PgTransactionManager(pool as any);

  return { manager, query, release };
}

describe("PgTransactionManager", () => {
  let security: TokenClaims;

  beforeEach(() => {
    security = {
      subject: "user-123",
      organisationId: "org-456",
    } as TokenClaims;
  });

  it("begins a transaction, sets the role, sets the RLS context, and commits", async () => {
    const h = makeHarness();

    const result = await h.manager.withTransaction(security, async () => "success");

    expect(result).toBe("success");
    expect(h.query.mock.calls[0]?.[0]).toBe("BEGIN");
    expect(h.query.mock.calls[1]?.[0]).toBe("SET LOCAL ROLE nabuuma_app");

    const settingsCall = h.query.mock.calls[2];
    expect(settingsCall?.[0]).toContain("set_config('app.user_id'");
    expect(settingsCall?.[1]).toEqual(["user-123", "org-456"]);

    expect(h.query.mock.calls[3]?.[0]).toBe("COMMIT");
    expect(h.release).toHaveBeenCalledOnce();
  });

  it("rolls back and releases when setting the application role fails", async () => {
    const failure = new Error("application role setup failed");
    const h = makeHarness();

    h.query.mockImplementation(async (sql: string) => {
      if (sql === "SET LOCAL ROLE nabuuma_app") {
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
      "ROLLBACK",
    ]);
    expect(h.release).toHaveBeenCalledOnce();
  });

  it("rolls back and releases when the RLS context fails", async () => {
    const failure = new Error("RLS context setup failed");
    const h = makeHarness();

    h.query.mockImplementation(async (sql: string) => {
      if (sql.includes("set_config('app.user_id'")) {
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

  it("rolls back and releases when the callback-failure occurs", async () => {
    const failure = new Error("work callback failed");
    const h = makeHarness();

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

  it("releases the connection even if ROLLBACK fails", async () => {
    const workFailure = new Error("work failed");
    const rollbackFailure = new Error("rollback failed");
    const h = makeHarness();

    h.query.mockImplementation(async (sql: string) => {
      if (sql === "ROLLBACK") {
        throw rollbackFailure;
      }
      return {};
    });

    await expect(
      h.manager.withTransaction(security, async () => {
        throw workFailure;
      }),
    ).rejects.toBe(workFailure);

    expect(h.release).toHaveBeenCalledOnce();
  });
});
