import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type {
  Pool,
  PoolClient,
} from "pg";
import {
  PgCertificateVerifier,
} from "../src/infrastructure/database/PgCertificateVerifier";

function createHarness(
  rows: Record<string, unknown>[],
) {
  const query = vi.fn(async (sql: string) => {
    if (sql === "BEGIN") {
      return { rows: [] };
    }

    if (
      sql ===
      "SET LOCAL ROLE nabuuma_certificate_verifier"
    ) {
      return { rows: [] };
    }

    if (sql === "COMMIT" || sql === "ROLLBACK") {
      return { rows: [] };
    }

    return { rows };
  });

  const release = vi.fn();

  const client = {
    query,
    release,
  } as unknown as PoolClient;

  const pool = {
    connect: vi.fn(async () => client),
  } as unknown as Pool;

  return {
    verifier: new PgCertificateVerifier(pool),
    query,
    release,
  };
}

describe("PgCertificateVerifier", () => {
  it("uses only the dedicated verifier database role", async () => {
    const h = createHarness([]);

    await h.verifier.verify("NAB-TEST");

    expect(h.query).toHaveBeenNthCalledWith(1, "BEGIN");

    expect(h.query).toHaveBeenNthCalledWith(
      2,
      "SET LOCAL ROLE nabuuma_certificate_verifier",
    );

    expect(h.query).not.toHaveBeenCalledWith(
      expect.stringContaining("nabuuma_app"),
    );

    expect(h.release).toHaveBeenCalledOnce();
  });

  it("returns only the public verification projection", async () => {
    const h = createHarness([
      {
        valid: true,
        status: "VALID",
        certificate_number: "NAB-TEST",
        issued_at: new Date(
          "2026-10-24T00:00:00.000Z",
        ),
        course_title: "Hospitality Foundations",
        revoked_at: null,
        learner_id: "must-not-leak",
        organisation_id: "must-not-leak",
        enrolment_id: "must-not-leak",
      },
    ]);

    await expect(
      h.verifier.verify("NAB-TEST"),
    ).resolves.toEqual({
      valid: true,
      status: "VALID",
      certificateNumber: "NAB-TEST",
      issuedAt: "2026-10-24T00:00:00.000Z",
      courseTitle: "Hospitality Foundations",
      revokedAt: null,
    });
  });

  it("maps a revoked certificate without leaking private revocation data", async () => {
    const h = createHarness([
      {
        valid: false,
        status: "REVOKED",
        certificate_number: "NAB-REVOKED",
        issued_at: "2026-10-24T00:00:00.000Z",
        course_title: "Hospitality Foundations",
        revoked_at: new Date(
          "2026-10-25T00:00:00.000Z",
        ),
        reason: "must-not-leak",
        revoked_by_id: "must-not-leak",
        organisation_id: "must-not-leak",
      },
    ]);

    await expect(
      h.verifier.verify("NAB-REVOKED"),
    ).resolves.toEqual({
      valid: false,
      status: "REVOKED",
      certificateNumber: "NAB-REVOKED",
      issuedAt: "2026-10-24T00:00:00.000Z",
      courseTitle: "Hospitality Foundations",
      revokedAt: "2026-10-25T00:00:00.000Z",
    });
  });

  it("returns null for an unknown certificate", async () => {
    const h = createHarness([]);

    await expect(
      h.verifier.verify("NAB-UNKNOWN"),
    ).resolves.toBeNull();
  });

  it("rolls back and releases the client on failure", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === "BEGIN") {
        return { rows: [] };
      }

      if (
        sql ===
        "SET LOCAL ROLE nabuuma_certificate_verifier"
      ) {
        return { rows: [] };
      }

      if (sql === "ROLLBACK") {
        return { rows: [] };
      }

      throw new Error("verification failure");
    });

    const release = vi.fn();

    const pool = {
      connect: vi.fn(async () => ({
        query,
        release,
      })),
    } as unknown as Pool;

    const verifier = new PgCertificateVerifier(pool);

    await expect(
      verifier.verify("NAB-TEST"),
    ).rejects.toThrow("verification failure");

    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });
});
