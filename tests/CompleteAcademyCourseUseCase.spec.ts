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
  CompleteAcademyCourseUseCase,
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

const learnerId =
  "11111111-1111-4111-8111-111111111111";

const courseId =
  "33333333-3333-4333-8333-333333333333";

const enrolmentId =
  "44444444-4444-4444-8444-444444444444";

const certificateId =
  "55555555-5555-4555-8555-555555555555";

const claims = {
  subject: learnerId,
  organisationId,
  roles: ["LEARNER"],
} as const satisfies TokenClaims;

const certificate = {
  id: certificateId,
  organisationId,
  learnerId,
  courseId,
  enrolmentId,
  certificateNumber: "NAB-TEST",
  issuedAt: "2026-10-25T05:00:00.000Z",
  metadata: {},
};

function createHarness(options?: {
  completionFailure?: Error;
  auditFailure?: Error;
}) {
  const completeCourse = vi.fn(async () => {
    if (options?.completionFailure) {
      throw options.completionFailure;
    }

    return certificate;
  });

  const recordAudit = vi.fn(
    async (
      _input: CreateAuditEventInput,
    ) => {
      if (options?.auditFailure) {
        throw options.auditFailure;
      }

      return {
        id: "66666666-6666-4666-8666-666666666666",
      };
    },
  );

  const academyRepository = {
    completeCourse,
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
    new CompleteAcademyCourseUseCase(
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
    completeCourse,
    recordAudit,
  };
}

describe("CompleteAcademyCourseUseCase", () => {
  it("completes and records certificate issuance in one transaction", async () => {
    const h = createHarness();

    const result = await h.useCase.execute(
      courseId,
      enrolmentId,
      claims,
    );

    expect(result).toEqual(certificate);
    expect(h.withTransaction).toHaveBeenCalledOnce();

    expect(h.repositoryFactory).toHaveBeenCalledWith(
      h.context,
    );
    expect(h.auditRepositoryFactory).toHaveBeenCalledWith(
      h.context,
    );

    expect(h.completeCourse).toHaveBeenCalledWith(
      courseId,
      enrolmentId,
    );

    expect(h.recordAudit).toHaveBeenCalledOnce();
    expect(h.recordAudit).toHaveBeenCalledWith({
      organisationId,
      actorUserId: learnerId,
      action: "CERTIFICATE.ISSUE",
      entityType: "ACADEMY_CERTIFICATE",
      entityId: certificateId,
      outcome: "SUCCESS",
      metadata: {
        certificateNumber: "NAB-TEST",
        courseId,
        enrolmentId,
      },
    });
  });

  it("does not audit when completion fails", async () => {
    const failure = new Error(
      "completion rejected",
    );

    const h = createHarness({
      completionFailure: failure,
    });

    const operation = h.useCase.execute(
      courseId,
      enrolmentId,
      claims,
    );

    await expect(operation).rejects.toBe(failure);
    expect(h.completeCourse).toHaveBeenCalledOnce();
    expect(h.auditRepositoryFactory).not.toHaveBeenCalled();
    expect(h.recordAudit).not.toHaveBeenCalled();
  });

  it("propagates audit failure so issuance cannot commit", async () => {
    const failure = new Error(
      "audit rejected",
    );

    const h = createHarness({
      auditFailure: failure,
    });

    const operation = h.useCase.execute(
      courseId,
      enrolmentId,
      claims,
    );

    await expect(operation).rejects.toBe(failure);
    expect(h.completeCourse).toHaveBeenCalledOnce();
    expect(h.recordAudit).toHaveBeenCalledOnce();
  });
});
