import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

const pool = new Pool({
  host: process.env.PGHOST ?? "localhost",
  port: Number(process.env.PGPORT ?? 55432),
  database: process.env.PGDATABASE ?? "nabuuma_test",
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
});

async function beginRlsContext(
  client: PoolClient,
  organisationId: string,
  userId: string,
): Promise<void> {
  await client.query("BEGIN");
  await client.query("SET ROLE nabuuma_app");

  await client.query(
    `
      SELECT
        set_config('app.user_id', $1, true),
        set_config('app.organisation_id', $2, true)
    `,
    [userId, organisationId],
  );
}

async function rollbackRlsContext(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } finally {
    await client.query("RESET ROLE");
  }
}

const runRlsIntegration =
  process.env.RUN_RLS_INTEGRATION === "1";

describe.skipIf(!runRlsIntegration)("Academy RLS security", () => {
  it("has an executable Academy integration harness", async () => {
    const result = await pool.query(
      "SELECT to_regclass('nabuuma.academy_enrolments') AS table_name",
    );

    expect(result.rows[0]?.table_name).toBe(
      "nabuuma.academy_enrolments",
    );
  });
});

afterAll(async () => {
  await pool.end();
});
