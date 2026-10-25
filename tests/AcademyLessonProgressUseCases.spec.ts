import { describe, expect, it, vi } from "vitest";
import {
  InvalidAcademyLessonProgressError,
  ListAcademyLessonsUseCase,
  UpdateAcademyLessonProgressUseCase,
} from "../src/application/academy";
import type { AcademyRepository } from "../src/domain/academy";
import type { TokenClaims } from "../src/infrastructure/security/security";

const claims: TokenClaims = {
  subject: "11111111-1111-4111-8111-111111111111",
  organisationId: "22222222-2222-4222-8222-222222222222",
  roles: ["LEARNER"],
};

function harness(repository: AcademyRepository) {
  const context = {
    organisationId: claims.organisationId,
    claims,
  } as any;

  const transactionManager = {
    withTransaction: vi.fn(
      async (
        _claims: TokenClaims,
        work: (context: any) => Promise<unknown>,
      ) => work(context),
    ),
  } as any;

  const auditRepository = {
    record: vi.fn(async () => undefined),
  };

  return {
    transactionManager,
    repositoryFactory: vi.fn(() => repository),
    auditRepository,
    auditRepositoryFactory: vi.fn(
      () => auditRepository,
    ),
  };
}

describe("Academy lesson progress use cases", () => {
  it("lists published lessons transactionally", async () => {
    const lessons = [{
      id: "lesson-1",
      organisationId: claims.organisationId,
      courseId: "course-1",
      stableKey: "espresso-basics",
      title: "Espresso basics",
      content: {},
      sequenceNumber: 1,
      isPublished: true,
    }];

    const repository = {
      listPublishedLessons: vi.fn(async () => lessons),
    } as unknown as AcademyRepository;

    const h = harness(repository);

    const useCase = new ListAcademyLessonsUseCase(
      h.transactionManager,
      h.repositoryFactory,
    );

    await expect(
      useCase.execute("course-1", claims),
    ).resolves.toEqual(lessons);

    expect(repository.listPublishedLessons)
      .toHaveBeenCalledWith("course-1");
  });

  it.each([
    ["NOT_STARTED", 1],
    ["IN_PROGRESS", 0],
    ["IN_PROGRESS", 100],
    ["COMPLETED", 99],
    ["COMPLETED", 101],
    ["COMPLETED", 99.5],
  ] as const)(
    "rejects invalid progress %s/%s before opening a transaction",
    async (status, progressPercent) => {
      const repository = {} as AcademyRepository;
      const h = harness(repository);

      const useCase =
        new UpdateAcademyLessonProgressUseCase(
          h.transactionManager,
          h.repositoryFactory,
          h.auditRepositoryFactory as any,
        );

      await expect(
        useCase.execute(
          {
            courseId: "course-1",
            enrolmentId: "enrolment-1",
            lessonId: "lesson-1",
            status,
            progressPercent,
          },
          claims,
        ),
      ).rejects.toBeInstanceOf(
        InvalidAcademyLessonProgressError,
      );

      expect(
        h.transactionManager.withTransaction,
      ).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["NOT_STARTED", 0],
    ["IN_PROGRESS", 1],
    ["IN_PROGRESS", 50],
    ["IN_PROGRESS", 99],
    ["COMPLETED", 100],
  ] as const)(
    "persists valid progress %s/%s",
    async (status, progressPercent) => {
      const saved = {
        id: "progress-1",
        organisationId: claims.organisationId,
        learnerId: claims.subject,
        courseId: "course-1",
        enrolmentId: "enrolment-1",
        lessonId: "lesson-1",
        status,
        progressPercent,
        lastActivityAt: "2026-10-22T00:00:00.000Z",
      };

      const repository = {
        getLessonProgress: vi.fn(async () => null),
        saveLessonProgress: vi.fn(async () => saved),
      } as unknown as AcademyRepository;

      const h = harness(repository);

      const useCase =
        new UpdateAcademyLessonProgressUseCase(
          h.transactionManager,
          h.repositoryFactory,
          h.auditRepositoryFactory as any,
        );

      await expect(
        useCase.execute(
          {
            courseId: "course-1",
            enrolmentId: "enrolment-1",
            lessonId: "lesson-1",
            status,
            progressPercent,
          },
          claims,
        ),
      ).resolves.toEqual(saved);
    },
  );

  it("prevents completed progress from regressing", async () => {
    const repository = {
      getLessonProgress: vi.fn(async () => ({
        id: "progress-1",
        organisationId: claims.organisationId,
        learnerId: claims.subject,
        courseId: "course-1",
        enrolmentId: "enrolment-1",
        lessonId: "lesson-1",
        status: "COMPLETED",
        progressPercent: 100,
        lastActivityAt: "2026-10-22T00:00:00.000Z",
      })),
      saveLessonProgress: vi.fn(),
    } as unknown as AcademyRepository;

    const h = harness(repository);

    const useCase =
      new UpdateAcademyLessonProgressUseCase(
        h.transactionManager,
        h.repositoryFactory,
        h.auditRepositoryFactory as any,
      );

    await expect(
      useCase.execute(
        {
          courseId: "course-1",
          enrolmentId: "enrolment-1",
          lessonId: "lesson-1",
          status: "IN_PROGRESS",
          progressPercent: 50,
        },
        claims,
      ),
    ).rejects.toBeInstanceOf(
      InvalidAcademyLessonProgressError,
    );

    expect(repository.saveLessonProgress)
      .not.toHaveBeenCalled();
  });

  it("allows an idempotent completed update", async () => {
    const completed = {
      id: "progress-1",
      organisationId: claims.organisationId,
      learnerId: claims.subject,
      courseId: "course-1",
      enrolmentId: "enrolment-1",
      lessonId: "lesson-1",
      status: "COMPLETED" as const,
      progressPercent: 100,
      lastActivityAt: "2026-10-22T00:00:00.000Z",
    };

    const repository = {
      getLessonProgress: vi.fn(async () => completed),
      saveLessonProgress: vi.fn(async () => completed),
    } as unknown as AcademyRepository;

    const h = harness(repository);

    const useCase =
      new UpdateAcademyLessonProgressUseCase(
        h.transactionManager,
        h.repositoryFactory,
        h.auditRepositoryFactory as any,
      );

    await expect(
      useCase.execute(
        {
          courseId: "course-1",
          enrolmentId: "enrolment-1",
          lessonId: "lesson-1",
          status: "COMPLETED",
          progressPercent: 100,
        },
        claims,
      ),
    ).resolves.toEqual(completed);
  });
});
