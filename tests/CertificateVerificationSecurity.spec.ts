import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const runIntegration =
  process.env.RUN_RLS_INTEGRATION === "1";

const pool = new Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 55432),
  database: process.env.PGDATABASE ?? "nabuuma_test",
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
});

describe.skipIf(!runIntegration)(
  "Certificate verification security",
  () => {
    it("exposes only the privacy-safe projection through the verifier role", async () => {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        await client.query(
          "SET LOCAL ROLE nabuuma_certificate_verifier",
        );

        const result = await client.query(
          `
            SELECT *
            FROM nabuuma.verify_academy_certificate(
              'NAB-UNKNOWN'
            )
          `,
        );

        expect(result.fields.map((field) => field.name)).toEqual([
          "valid",
          "status",
          "certificate_number",
          "issued_at",
          "course_title",
          "revoked_at",
        ]);

        expect(result.rows).toEqual([]);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });

    it("cannot read certificate storage directly", async () => {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        await client.query(
          "SET LOCAL ROLE nabuuma_certificate_verifier",
        );

        await expect(
          client.query(
            "SELECT id FROM nabuuma.academy_certificates LIMIT 1",
          ),
        ).rejects.toMatchObject({
          code: "42501",
        });
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    });
  },
);

afterAll(async () => {
  await pool.end();
});
