import type { Pool } from "pg";

export type CertificateVerificationStatus =
  | "VALID"
  | "REVOKED";

export interface CertificateVerification {
  readonly valid: boolean;
  readonly status: CertificateVerificationStatus;
  readonly certificateNumber: string;
  readonly issuedAt: string;
  readonly courseTitle: string;
  readonly revokedAt: string | null;
}

interface CertificateVerificationRow {
  valid: boolean;
  status: CertificateVerificationStatus;
  certificate_number: string;
  issued_at: Date | string;
  course_title: string;
  revoked_at: Date | string | null;
}

function timestamp(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : value;
}

export class PgCertificateVerifier {
  constructor(private readonly pool: Pool) {}

  async verify(
    certificateNumber: string,
  ): Promise<CertificateVerification | null> {
    const client = await this.pool.connect();
    let transactionStarted = false;

    try {
      await client.query("BEGIN");
      transactionStarted = true;

      await client.query(
        "SET LOCAL ROLE nabuuma_certificate_verifier",
      );

      const result =
        await client.query<CertificateVerificationRow>(
          `
            SELECT
              valid,
              status,
              certificate_number,
              issued_at,
              course_title,
              revoked_at
            FROM nabuuma.verify_academy_certificate($1::text)
          `,
          [certificateNumber],
        );

      await client.query("COMMIT");
      transactionStarted = false;

      const row = result.rows[0];

      if (!row) {
        return null;
      }

      return {
        valid: row.valid,
        status: row.status,
        certificateNumber: row.certificate_number,
        issuedAt: timestamp(row.issued_at),
        courseTitle: row.course_title,
        revokedAt:
          row.revoked_at === null
            ? null
            : timestamp(row.revoked_at),
      };
    } catch (error) {
      if (transactionStarted) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the original database failure.
        }
      }

      throw error;
    } finally {
      client.release();
    }
  }
}
