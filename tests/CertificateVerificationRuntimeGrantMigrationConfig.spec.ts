import {
  describe,
  expect,
  it,
} from "vitest";
import {
  readFile,
} from "node:fs/promises";

const migrationUrl = new URL(
  "../db/migrations/00020_allow_runtime_certificate_verification.sql",
  import.meta.url,
);

async function migration(): Promise<string> {
  return readFile(migrationUrl, "utf8");
}

describe("certificate verification runtime grant migration", () => {
  it("grants EXECUTE only on the privacy-safe verification function", async () => {
    const sql = await migration();

    expect(sql).toMatch(
      /GRANT EXECUTE\s+ON FUNCTION nabuuma\.verify_academy_certificate\(TEXT\)\s+TO nabuuma_runtime;/s,
    );
    expect(sql).toContain("GRANT USAGE ON SCHEMA nabuuma TO nabuuma_runtime;");
    expect(sql).not.toMatch(/GRANT\s+(SELECT|ALL)\s+ON\s+TABLE/i);
    expect(sql).not.toMatch(/GRANT\s+[^;]*TO\s+nabuuma_certificate_verifier/i);
  });

  it("preserves the function owner, SECURITY DEFINER, and hardened search path", async () => {
    const sql = await migration();

    expect(sql).toContain("nabuuma_auth_owner");
    expect(sql).toContain("function_proc.prosecdef");
    expect(sql).toContain("search_path=pg_catalog");
  });

  it("prohibits verifier membership and direct certificate-table SELECT", async () => {
    const sql = await migration();

    expect(sql).toContain("pg_has_role(");
    expect(sql).toContain("nabuuma_certificate_verifier");
    expect(sql).toContain("has_schema_privilege(");
    expect(sql).toContain("has_table_privilege(");
    expect(sql).toContain("nabuuma.academy_certificates");
  });

  it("is atomic", async () => {
    const sql = (await migration()).trim();

    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(sql.startsWith("BEGIN;")).toBe(true);
    expect(sql.endsWith("COMMIT;")).toBe(true);
  });

  it("does not elevate role attributes", async () => {
    const sql = (await migration())
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");

    expect(sql).not.toMatch(/\bSUPERUSER\b/i);
    expect(sql).not.toMatch(/\bBYPASSRLS\b/i);
    expect(sql).not.toMatch(/\bALTER ROLE\b/i);
  });
});
