import {
  describe,
  expect,
  it,
} from "vitest";
import {
  readFile,
} from "node:fs/promises";

const migrationUrl = new URL(
  "../db/migrations/00018_reconcile_certificate_verification_authority.sql",
  import.meta.url,
);

async function migration(): Promise<string> {
  return readFile(
    migrationUrl,
    "utf8",
  );
}

describe(
  "certificate verification ownership migration",
  () => {
    it(
      "establishes the restricted verifier authority boundary",
      async () => {
        // Arrange
        const sql =
          await migration();

        // Act
        const requiredFragments = [
          "OWNER TO nabuuma_auth_owner",
          "academy_certificates_verifier_select",
          "academy_courses_verifier_select",
          "academy_certificate_revocations_verifier_select",
          "TO nabuuma_certificate_verifier",
          "SET search_path = pg_catalog",
        ] as const;

        // Assert
        for (
          const fragment
          of requiredFragments
        ) {
          expect(sql).toContain(
            fragment,
          );
        }
      },
    );

    it(
      "grants only the certificate columns required by public verification",
      async () => {
        // Arrange
        const sql =
          await migration();

        // Act
        const certificateGrant =
          /GRANT SELECT \(\s*id,\s*organisation_id,\s*course_id,\s*certificate_number,\s*issued_at\s*\)\s*ON TABLE nabuuma\.academy_certificates\s*TO nabuuma_auth_owner;/s;

        // Assert
        expect(sql).toMatch(
          certificateGrant,
        );

        expect(sql).toContain(
          "'learner_id'",
        );

        expect(sql).toContain(
          "'enrolment_id'",
        );

        expect(sql).toContain(
          "'issued_by_id'",
        );

        expect(sql).toContain(
          "'metadata'",
        );
      },
    );

    it(
      "does not introduce privilege escalation or RLS bypasses",
      async () => {
        // Arrange
        const sql =
          await migration();

        // Act
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
        expect(
          executableSql,
        ).not.toMatch(
          /\bBYPASSRLS\b/,
        );

        expect(
          executableSql,
        ).not.toMatch(
          /\bSUPERUSER\b/,
        );

        expect(
          executableSql,
        ).not.toMatch(
          /\bsession_replication_role\b/,
        );

        expect(
          executableSql,
        ).not.toMatch(
          /\bDISABLE\s+TRIGGER\b/,
        );

        expect(
          executableSql,
        ).not.toMatch(
          /\bGRANT\s+ALL\b/,
        );
      },
    );

    it(
      "keeps the migration atomic",
      async () => {
        // Arrange
        const sql =
          (await migration()).trim();

        // Act
        const beginCount =
          sql.match(
            /^BEGIN;$/gm,
          )?.length ?? 0;

        const commitCount =
          sql.match(
            /^COMMIT;$/gm,
          )?.length ?? 0;

        // Assert
        expect(beginCount).toBe(1);
        expect(commitCount).toBe(1);
        expect(
          sql.startsWith("BEGIN;"),
        ).toBe(true);
        expect(
          sql.endsWith("COMMIT;"),
        ).toBe(true);
      },
    );
  },
);
