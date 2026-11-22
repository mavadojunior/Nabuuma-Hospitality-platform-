import {
  describe,
  expect,
  it,
} from "vitest";
import {
  readFile,
} from "node:fs/promises";

const migrationUrl = new URL(
  "../db/migrations/00019_harden_certificate_revocation_authority.sql",
  import.meta.url,
);

async function migration(): Promise<string> {
  return readFile(
    migrationUrl,
    "utf8",
  );
}

describe(
  "certificate revocation ownership migration",
  () => {
    it(
      "creates a restricted non-login revocation owner",
      async () => {
        // Arrange
        const sql = await migration();

        // Assert
        expect(sql).toContain(
          "CREATE ROLE nabuuma_certificate_revoke_owner",
        );
        expect(sql).toContain("NOLOGIN");
        expect(sql).toContain("NOSUPERUSER");
        expect(sql).toContain("NOINHERIT");
        expect(sql).toContain("NOBYPASSRLS");
        expect(sql).toContain("NOCREATEROLE");
        expect(sql).toContain("NOCREATEDB");
        expect(sql).toContain("NOREPLICATION");
      },
    );

    it(
      "grants only the required certificate read columns",
      async () => {
        // Arrange
        const sql = await migration();

        const grant =
          /GRANT SELECT \(\s*id,\s*organisation_id,\s*learner_id,\s*certificate_number\s*\)\s*ON TABLE nabuuma\.academy_certificates\s*TO nabuuma_certificate_revoke_owner;/s;

        // Assert
        expect(sql).toMatch(grant);
        expect(sql).not.toMatch(
          /GRANT SELECT \([^)]*\bmetadata\b[^)]*\)\s*ON TABLE nabuuma\.academy_certificates/s,
        );
      },
    );

    it(
      "grants only the required revocation insert columns",
      async () => {
        // Arrange
        const sql = await migration();

        const grant =
          /GRANT INSERT \(\s*organisation_id,\s*certificate_id,\s*revoked_by_id,\s*reason\s*\)\s*ON TABLE nabuuma\.academy_certificate_revocations\s*TO nabuuma_certificate_revoke_owner;/s;

        // Assert
        expect(sql).toMatch(grant);
        expect(sql).not.toMatch(
          /GRANT INSERT \([^)]*\bcreated_at\b[^)]*\)/s,
        );
      },
    );

    it(
      "installs tenant and actor constrained revocation policies",
      async () => {
        // Arrange
        const sql = await migration();

        // Assert
        expect(sql).toContain(
          "academy_certificates_revoker_select",
        );
        expect(sql).toContain(
          "academy_certificate_revocations_revoker_select",
        );
        expect(sql).toContain(
          "academy_certificate_revocations_revoker_insert",
        );
        expect(sql).toContain(
          "nabuuma.current_app_organisation_id()",
        );
        expect(sql).toContain(
          "nabuuma.current_app_user_id()",
        );
        expect(sql).toContain(
          "nabuuma.is_authorized_assessor(",
        );
      },
    );

    it(
      "moves privileged functions away from the administrative superuser",
      async () => {
        // Arrange
        const sql = await migration();

        // Assert
        expect(sql).toMatch(
          /ALTER FUNCTION\s+nabuuma\.revoke_academy_certificate\(\s*TEXT,\s*TEXT\s*\)\s*OWNER TO nabuuma_certificate_revoke_owner;/s,
        );

        expect(sql).toMatch(
          /ALTER FUNCTION\s+nabuuma\.prevent_certificate_revocation_mutation\(\)\s*OWNER TO nabuuma_certificate_revoke_owner;/s,
        );

        expect(sql).toMatch(
          /nabuuma\.revoke_academy_certificate\(\s*TEXT,\s*TEXT\s*\)\s*SECURITY DEFINER;/s,
        );

        expect(sql).toMatch(
          /nabuuma\.prevent_certificate_revocation_mutation\(\)\s*SECURITY INVOKER;/s,
        );
      },
    );

    it(
      "preserves the function-only application entry point",
      async () => {
        // Arrange
        const sql = await migration();

        // Assert
        expect(sql).toMatch(
          /GRANT EXECUTE\s+ON FUNCTION nabuuma\.revoke_academy_certificate\(\s*TEXT,\s*TEXT\s*\)\s+TO nabuuma_app;/s,
        );

        expect(sql).not.toMatch(
          /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)(?:\s*\([^;]*\))?\s+ON\s+(?:TABLE\s+)?[^\s;]+\s+TO\s+nabuuma_app;/s,
        );
      },
    );

    it(
      "does not introduce security bypasses",
      async () => {
        // Arrange
        const sql = await migration();

        const executableSql = sql
          .split("\n")
          .filter(
            (line) =>
              !line
                .trimStart()
                .startsWith("--"),
          )
          .join("\n");

        // Assert
        expect(executableSql).not.toMatch(
          /\bsession_replication_role\b/,
        );
        expect(executableSql).not.toMatch(
          /\bDISABLE\s+TRIGGER\b/,
        );
        expect(executableSql).not.toMatch(
          /\bGRANT\s+ALL\b/,
        );
      },
    );

    it(
      "is atomic",
      async () => {
        // Arrange
        const sql =
          (await migration()).trim();

        // Assert
        expect(
          sql.match(/^BEGIN;$/gm)?.length ?? 0,
        ).toBe(1);

        expect(
          sql.match(/^COMMIT;$/gm)?.length ?? 0,
        ).toBe(1);

        expect(sql.startsWith("BEGIN;")).toBe(true);
        expect(sql.endsWith("COMMIT;")).toBe(true);
      },
    );
  },
);
