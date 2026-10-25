import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  EnrolInAcademyCourseUseCase,
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

const enrolment = {
  id: "33333333-3333-4333-8333-333333333333",
  organisationId,
  learnerId,
  courseId: "course-1",
  status: "ACTIVE",
  enrolledAt: "2026-10-25T05:00:00.000Z",
} as const;

describe("Academy enrolment audit atomicity", () => {
  it("rejects the transaction callback when audit recording fails", async () => {
    // Arrange
    const auditFailure = new Error(
      "audit persistence rejected",
    );

    const getEnrolment = vi.fn(
      async () => null,
    );

    const getCourseById = vi.fn(
      async () => ({
        id: "course-1",
        organisationId,
        stableKey: "course",
        version: 1,
        title: "Course",
        description: "",
        isPublished: true,
      }),
    );

    const enrol = vi.fn(
      async () => enrolment,
    );

    const academyRepository = {
      getEnrolment,
      getCourseById,
      enrol,
    } as unknown as AcademyRepository;

    const recordAudit = vi.fn(
      async (
        _input: CreateAuditEventInput,
      ): Promise<never> => {
        throw auditFailure;
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
      new EnrolInAcademyCourseUseCase(
        transactionManager,
        () => academyRepository,
        () => auditRepository,
      );

    // Act
    const operation = useCase.execute(
      "course-1",
      claims,
    );

    // Assert
    await expect(operation).rejects.toBe(
      auditFailure,
    );

    expect(enrol).toHaveBeenCalledOnce();
    expect(recordAudit).toHaveBeenCalledOnce();
    expect(withTransaction).toHaveBeenCalledOnce();
  });
});
