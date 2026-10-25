import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  UpdateAcademyLessonProgressUseCase,
} from "../src/application/academy";
import type {
  AcademyRepository,
} from "../src/domain/academy";
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

const claims = {
  subject: learnerId,
  organisationId,
  roles: ["LEARNER"],
} as const satisfies TokenClaims;

const input = {
  courseId: "course-1",
  enrolmentId: "enrolment-1",
  lessonId: "lesson-1",
  status: "IN_PROGRESS" as const,
  progressPercent: 50,
};

const progress = {
  id: "33333333-3333-4333-8333-333333333333",
  organisationId,
  learnerId,
  courseId: input.courseId,
  enrolmentId: input.enrolmentId,
  lessonId: input.lessonId,
  status: input.status,
  progressPercent: input.progressPercent,
  lastActivityAt: "2026-10-25T05:00:00.000Z",
};

function createHarness(options?: {
  auditFailure?: Error;
}) {
  const getEnrolment = vi.fn(async () => ({
    id: input.enrolmentId,
    organisationId,
    learnerId,
    courseId: input.courseId,
    status: "ACTIVE" as const,
    enrolledAt: "2026-10-25T04:00:00.000Z",
  }));

  const getLessonProgress = vi.fn(
    async () => null,
  );

  const saveLessonProgress = vi.fn(
    async () => progress,
  );

  const repository = {
    getEnrolment,
    getLessonProgress,
    saveLessonProgress,
  } as unknown as AcademyRepository;

  const recordAudit = vi.fn(
    async (
      _audit: CreateAuditEventInput,
    ) => {
      if (options?.auditFailure) {
        throw options.auditFailure;
      }

      return {
        id: "44444444-4444-4444-8444-444444444444",
      };
    },
  );

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

  const useCase =
    new UpdateAcademyLessonProgressUseCase(
      transactionManager,
      () => repository,
      () => auditRepository,
    );

  return {
    useCase,
    saveLessonProgress,
    recordAudit,
  };
}

describe("Academy lesson progress audit atomicity", () => {
  it("records successful progress mutation in the same transaction", async () => {
    const h = createHarness();

    const result = await h.useCase.execute(
      input,
      claims,
    );

    expect(result).toEqual(progress);

    expect(
      h.saveLessonProgress,
    ).toHaveBeenCalledOnce();

    expect(h.recordAudit).toHaveBeenCalledOnce();
    expect(h.recordAudit).toHaveBeenCalledWith({
      organisationId,
      actorUserId: learnerId,
      action: "ACADEMY.LESSON_PROGRESS.UPDATE",
      entityType: "ACADEMY_LESSON_PROGRESS",
      entityId: progress.id,
      outcome: "SUCCESS",
      metadata: {
        courseId: progress.courseId,
        enrolmentId: progress.enrolmentId,
        lessonId: progress.lessonId,
        status: progress.status,
        progressPercent: progress.progressPercent,
      },
    });
  });

  it("rejects the transaction callback when audit persistence fails", async () => {
    const failure = new Error(
      "audit persistence rejected",
    );

    const h = createHarness({
      auditFailure: failure,
    });

    const operation = h.useCase.execute(
      input,
      claims,
    );

    await expect(operation).rejects.toBe(
      failure,
    );

    expect(
      h.saveLessonProgress,
    ).toHaveBeenCalledOnce();

    expect(h.recordAudit).toHaveBeenCalledOnce();
  });
});
