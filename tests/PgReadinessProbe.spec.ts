import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Pool, PoolClient } from "pg";
import {
  PgReadinessProbe,
} from "../src/infrastructure/database/PgReadinessProbe";

function createPool(
  query: PoolClient["query"],
  release = vi.fn(),
): Pool {
  return {
    connect: vi.fn(async () => ({
      query,
      release,
    })),
  } as unknown as Pool;
}

describe("PgReadinessProbe", () => {
  it("reports ready after a successful database probe", async () => {
    const release = vi.fn();

    const query = vi.fn(async () => ({
      rows: [{ ready: 1 }],
    })) as unknown as PoolClient["query"];

    const probe = new PgReadinessProbe(
      createPool(query, release),
    );

    await expect(probe.isReady()).resolves.toBe(true);
    expect(release).toHaveBeenCalledOnce();
  });

  it("reports not ready when the database probe fails", async () => {
    const release = vi.fn();

    const query = vi.fn(async () => {
      throw new Error("database unavailable");
    }) as unknown as PoolClient["query"];

    const probe = new PgReadinessProbe(
      createPool(query, release),
    );

    await expect(probe.isReady()).resolves.toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });

  it("reports not ready when connection acquisition fails", async () => {
    const pool = {
      connect: vi.fn(async () => {
        throw new Error("pool unavailable");
      }),
    } as unknown as Pool;

    const probe = new PgReadinessProbe(pool);

    await expect(probe.isReady()).resolves.toBe(false);
  });
});
