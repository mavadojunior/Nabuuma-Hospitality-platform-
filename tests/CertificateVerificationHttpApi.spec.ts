import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { FastifyInstance } from "fastify";
import type {
  AcademyApplicationServices,
} from "../src/bootstrap";
import type {
  CertificateVerification,
} from "../src/infrastructure/database/PgCertificateVerifier";
import {
  createHttpApplication,
} from "../src/interfaces/http/app";
import type {
  RequestAuthenticator,
} from "../src/interfaces/http/authentication";

const apps: FastifyInstance[] = [];

type VerifyCertificate = (
  certificateNumber: string,
) => Promise<CertificateVerification | null>;

async function createHarness(
  verify: ReturnType<typeof vi.fn<VerifyCertificate>>,
) {
  const authenticate = vi.fn();

  const app = await createHttpApplication({
    academyServices: {} as AcademyApplicationServices,
    authenticator: {
      authenticate,
    } as unknown as RequestAuthenticator,
    certificateVerifier: {
      verify,
    },
  });

  apps.push(app);

  return {
    app,
    authenticate,
  };
}

afterEach(async () => {
  await Promise.all(
    apps.splice(0).map(async (app) => app.close()),
  );
});

describe("Certificate verification HTTP API", () => {
  it("returns the privacy-safe verification projection without authentication", async () => {
    const verify = vi.fn(async () => ({
      valid: true,
      status: "VALID" as const,
      certificateNumber: "NAB-TEST123",
      issuedAt: "2026-10-24T00:00:00.000Z",
      courseTitle: "Hospitality Foundations",
      revokedAt: null,
    }));

    const h = await createHarness(verify);

    const response = await h.app.inject({
      method: "GET",
      url:
        "/api/v1/academy/certificates/" +
        "NAB-TEST123/verification",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        valid: true,
        status: "VALID",
        certificateNumber: "NAB-TEST123",
        issuedAt: "2026-10-24T00:00:00.000Z",
        courseTitle: "Hospitality Foundations",
        revokedAt: null,
      },
    });

    expect(verify).toHaveBeenCalledWith("NAB-TEST123");
    expect(h.authenticate).not.toHaveBeenCalled();

    expect(response.body).not.toContain("learnerId");
    expect(response.body).not.toContain("organisationId");
    expect(response.body).not.toContain("enrolmentId");
  });

  it("returns the privacy-safe revoked projection", async () => {
    const verify = vi.fn(async () => ({
      valid: false,
      status: "REVOKED" as const,
      certificateNumber: "NAB-REVOKED123",
      issuedAt: "2026-10-24T00:00:00.000Z",
      courseTitle: "Hospitality Foundations",
      revokedAt: "2026-10-25T00:00:00.000Z",
    }));

    const h = await createHarness(verify);

    const response = await h.app.inject({
      method: "GET",
      url:
        "/api/v1/academy/certificates/" +
        "NAB-REVOKED123/verification",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        valid: false,
        status: "REVOKED",
        certificateNumber: "NAB-REVOKED123",
        issuedAt: "2026-10-24T00:00:00.000Z",
        courseTitle: "Hospitality Foundations",
        revokedAt: "2026-10-25T00:00:00.000Z",
      },
    });

    expect(response.body).not.toContain("reason");
    expect(response.body).not.toContain("revokedBy");
    expect(response.body).not.toContain("learnerId");
    expect(response.body).not.toContain("organisationId");
    expect(h.authenticate).not.toHaveBeenCalled();
  });

  it("returns a non-identifying invalid response for an unknown certificate", async () => {
    const verify = vi.fn(async () => null);
    const h = await createHarness(verify);

    const response = await h.app.inject({
      method: "GET",
      url:
        "/api/v1/academy/certificates/" +
        "NAB-UNKNOWN/verification",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        valid: false,
      },
    });

    expect(h.authenticate).not.toHaveBeenCalled();
  });

  it("rejects malformed certificate numbers before database access", async () => {
    const verify = vi.fn();
    const h = await createHarness(verify);

    const response = await h.app.inject({
      method: "GET",
      url:
        "/api/v1/academy/certificates/" +
        "invalid_number/verification",
    });

    expect(response.statusCode).toBe(400);
    expect(verify).not.toHaveBeenCalled();
    expect(h.authenticate).not.toHaveBeenCalled();
  });

  it("sanitises verification infrastructure failures", async () => {
    const verify = vi.fn(async () => {
      throw new Error("database secret");
    });

    const h = await createHarness(verify);

    const response = await h.app.inject({
      method: "GET",
      url:
        "/api/v1/academy/certificates/" +
        "NAB-TEST123/verification",
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("database secret");
    expect(response.json()).toEqual({
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
    });
  });
});
