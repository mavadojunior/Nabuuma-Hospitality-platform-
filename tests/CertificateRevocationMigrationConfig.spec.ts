import {
  describe,
  expect,
  it,
} from "vitest";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL(
  "../db/migrations/00010_academy_certificate_revocation.sql",
  import.meta.url,
);

async function migration(): Promise<string> {
  return readFile(migrationUrl, "utf8");
}

describe("certificate revocation migration", () => {
  it("is an explicit atomic migration", async () => {
    const content = await migration();

    expect(content.startsWith("BEGIN;\n")).toBe(true);
    expect(content.endsWith("COMMIT;\n")).toBe(true);
  });

  it("uses an append-only revocation ledger", async () => {
    const content = await migration();

    expect(content).toContain(
      "CREATE TABLE nabuuma.academy_certificate_revocations",
    );
    expect(content).toContain(
      "UNIQUE (certificate_id)",
    );
    expect(content).toContain(
      "BEFORE UPDATE OR DELETE",
    );
    expect(content).toContain(
      "Certificate revocations are append-only",
    );
  });

  it("enforces tenant and actor authorisation", async () => {
    const content = await migration();

    expect(content).toContain(
      "nabuuma.current_app_user_id()",
    );
    expect(content).toContain(
      "nabuuma.current_app_organisation_id()",
    );
    expect(content).toContain(
      "certificate.learner_id",
    );
    expect(content).toContain(
      "nabuuma.is_authorized_assessor(\n        tenant_id,\n        actor_id,\n        target_learner_id",
    );
    expect(content).toContain(
      "certificate.organisation_id = tenant_id",
    );
  });

  it("is idempotent per certificate", async () => {
    const content = await migration();

    expect(content).toContain(
      "ON CONFLICT (certificate_id)",
    );
    expect(content).toContain(
      "DO NOTHING",
    );
    expect(content).toContain(
      "newly_revoked BOOLEAN",
    );
  });

  it("keeps the ledger inaccessible to the application role", async () => {
    const content = await migration();

    expect(content).toContain(
      "REVOKE ALL\nON TABLE nabuuma.academy_certificate_revocations\nFROM nabuuma_app",
    );
    expect(content).toContain(
      "GRANT EXECUTE\nON FUNCTION nabuuma.revoke_academy_certificate(TEXT, TEXT)\nTO nabuuma_app",
    );
  });

  it("exposes only privacy-safe revocation state", async () => {
    const content = await migration();

    expect(content).toContain(
      "revocation.id IS NULL AS valid",
    );
    expect(content).toContain(
      "ELSE 'REVOKED'",
    );
    expect(content).toContain(
      "revocation.revoked_at",
    );

    const verification = content.slice(
      content.indexOf(
        "CREATE FUNCTION nabuuma.verify_academy_certificate",
      ),
    );

    expect(verification).not.toContain(
      "revoked_by_id",
    );
    expect(verification).not.toContain(
      "revocation.reason",
    );
  });
});
