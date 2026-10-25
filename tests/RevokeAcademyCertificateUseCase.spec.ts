import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type {
  AcademyRepository,
} from "../src/domain/academy";
import {
  RevokeAcademyCertificateUseCase,
} from "../src/application/academy";
import type {
  CreateAuditEventInput,
  PgAuditRepository,
} from "../src/infrastructure/database/repositories/PgAuditRepository";
import type {
  PgExecutionContext,
  PgTransactionManager,
} from "../src/infrastructure/database/transaction";
import type {
  TokenClaims,
} from "../src/infrastructure/security/security";

const organisationId =
  "22222222-2222-4222-8222-222222222222";

const actorId =
  "11111111-1111-4111-8111-111111111111";

const claims = {
  subject: actorId,
  organisationId,
  roles: ["TRAINER"],
} as const satisfies TokenClaims;

const revocation = {
  certificateNumber: "NAB-TEST",
  revokedAt: "2026-10-25T05:00:00.000Z",
  newlyRevoked: true,
};

function createHarness(options?: {
  revokeFailure?: Error;
  auditFailure?: Error;
}) {
  const revokeCertificate = vi.fn(async () => {
    if (options?.revokeFailure) {
      throw options.revokeFailure;
    }

    return revocation;
  });

  const recordAudit = vi.fn(
    async (
      _input: CreateAuditEventInput,
    ) => {
      if (options?.auditFailure) {
        throw options.auditFailure;
      }

      return {
        id: "33333333-3333-4333-8333-333333333333",
      };
    },
  );

  const academyRepository = {
    revokeCertificate,
  } as unknown as AcademyRepository;

  const auditRepository = {
    record: recordAudit,
  } as unknown as PgAuditRepository;

  const context = {
    organisationId,
    claims,
  } as unknown as PgExecutionContext;

  const withTransaction = vi.fn(
    async (
      receivedClaims: TokenClaims,
      work: (
        value: PgExecutionContext,
      ) => Promise<unknown>,
    ) => {
      expect(receivedClaims).toBe(claims);
      return work(context);
    },
  );

  const transactionManager = {
    withTransaction,
  } as unknown as PgTransactionManager;

  const repositoryFactory = vi.fn(
    () => academyRepository,
  );

  const auditRepositoryFactory = vi.fn(
    () => auditRepository,
  );

  const useCase =
    new RevokeAcademyCertificateUseCase(
      transactionManager,
      repositoryFactory,
      auditRepositoryFactory,
    );

  return {
    useCase,
    context,
    withTransaction,
    repositoryFactory,
    auditRepositoryFactory,
    revokeCertificate,
    recordAudit,
  };
}

describe("RevokeAcademyCertificateUseCase", () => {
  it("revokes and records the audit event in one transaction", async () => {
    const h = createHarness();

    const result = await h.useCase.execute(
      {
        certificateNumber: "NAB-TEST",
        reason: "Issued in error",
      },
      claims,
    );

    expect(result).toEqual(revocation);
    expect(h.withTransaction).toHaveBeenCalledOnce();

    expect(h.repositoryFactory).toHaveBeenCalledWith(
      h.context,
    );
    expect(h.auditRepositoryFactory).toHaveBeenCalledWith(
      h.context,
    );

    expect(h.revokeCertificate).toHaveBeenCalledWith(
      "NAB-TEST",
      "Issued in error",
    );

    expect(h.recordAudit).toHaveBeenCalledOnce();
    expect(h.recordAudit).toHaveBeenCalledWith({
      organisationId,
      actorUserId: actorId,
      action: "CERTIFICATE.REVOKE",
      entityType: "ACADEMY_CERTIFICATE",
      outcome: "SUCCESS",
      metadata: {
        certificateNumber: "NAB-TEST",
        newlyRevoked: true,
      },
    });
  });

  it("does not record an audit event when revocation fails", async () => {
    const failure = new Error(
      "revocation rejected",
    );

    const h = createHarness({
      revokeFailure: failure,
    });

    const operation = h.useCase.execute(
      {
        certificateNumber: "NAB-TEST",
        reason: "Issued in error",
      },
      claims,
    );

    await expect(operation).rejects.toBe(failure);
    expect(h.revokeCertificate).toHaveBeenCalledOnce();
    expect(h.auditRepositoryFactory).not.toHaveBeenCalled();
    expect(h.recordAudit).not.toHaveBeenCalled();
  });

  it("propagates audit failure so the transaction cannot commit", async () => {
    const failure = new Error(
      "audit rejected",
    );

    const h = createHarness({
      auditFailure: failure,
    });

    const operation = h.useCase.execute(
      {
        certificateNumber: "NAB-TEST",
        reason: "Issued in error",
      },
      claims,
    );

    await expect(operation).rejects.toBe(failure);
    expect(h.revokeCertificate).toHaveBeenCalledOnce();
    expect(h.recordAudit).toHaveBeenCalledOnce();
  });

  it("excludes the private revocation reason from audit metadata", async () => {
    const h = createHarness();

    await h.useCase.execute(
      {
        certificateNumber: "NAB-TEST",
        reason: "Sensitive administrative reason",
      },
      claims,
    );

    const auditInput =
      h.recordAudit.mock.calls[0]?.[0];

    expect(auditInput).toBeDefined();
    expect(auditInput?.metadata).not.toHaveProperty(
      "reason",
    );
    expect(
      JSON.stringify(auditInput),
    ).not.toContain(
      "Sensitive administrative reason",
    );
  });
});
