import { describe, expect, it, vi } from "vitest";
import {
  AcademyCourseUnavailableError,
  EnrolInAcademyCourseUseCase,
  ListPublishedAcademyCoursesUseCase,
} from "../src/application/academy";
import type { AcademyRepository } from "../src/domain/academy";

const claims = {
  subject: "11111111-1111-4111-8111-111111111111",
  organisationId: "22222222-2222-4222-8222-222222222222",
  roles: ["LEARNER"] as const,
};

function harness(repository: AcademyRepository) {
  const context = {
    organisationId: claims.organisationId,
    claims,
  } as any;

  const transactionManager = {
    withTransaction: vi.fn(
      async (_claims: unknown, work: (context: any) => Promise<unknown>) =>
        work(context),
    ),
  } as any;

  return {
    context,
    transactionManager,
    repositoryFactory: vi.fn(() => repository),
  };
}

describe("Academy application use cases", () => {
  it("lists published courses through the transactional repository", async () => {
    const courses = [{
      id: "course-1",
      organisationId: claims.organisationId,
      stableKey: "espresso",
      version: 1,
      title: "Espresso",
      description: "",
      isPublished: true,
    }];

    const repository = {
      listPublishedCourses: vi.fn(async () => courses),
    } as unknown as AcademyRepository;

    const h = harness(repository);
    const useCase = new ListPublishedAcademyCoursesUseCase(
      h.transactionManager,
      h.repositoryFactory,
    );

    await expect(useCase.execute(claims)).resolves.toEqual(courses);
    expect(repository.listPublishedCourses).toHaveBeenCalledOnce();
  });

  it("returns an existing enrolment idempotently", async () => {
    const enrolment = {
      id: "enrolment-1",
      organisationId: claims.organisationId,
      learnerId: claims.subject,
      courseId: "course-1",
      status: "ACTIVE" as const,
      enrolledAt: "2026-10-22T00:00:00.000Z",
    };

    const repository = {
      getCourseById: vi.fn(async () => ({ id: "course-1" })),
      getEnrolment: vi.fn(async () => enrolment),
      enrol: vi.fn(),
    } as unknown as AcademyRepository;

    const h = harness(repository);
    const useCase = new EnrolInAcademyCourseUseCase(
      h.transactionManager,
      h.repositoryFactory,
    );

    await expect(useCase.execute("course-1", claims)).resolves.toEqual(
      enrolment,
    );
    expect(repository.enrol).not.toHaveBeenCalled();
  });

  it("creates an enrolment when none exists", async () => {
    const repository = {
      getCourseById: vi.fn(async () => ({ id: "course-1" })),
      getEnrolment: vi.fn(async () => null),
      enrol: vi.fn(async () => ({
        id: "enrolment-1",
        organisationId: claims.organisationId,
        learnerId: claims.subject,
        courseId: "course-1",
        status: "ACTIVE",
        enrolledAt: "2026-10-22T00:00:00.000Z",
      })),
    } as unknown as AcademyRepository;

    const h = harness(repository);
    const useCase = new EnrolInAcademyCourseUseCase(
      h.transactionManager,
      h.repositoryFactory,
    );

    await useCase.execute("course-1", claims);

    expect(repository.enrol).toHaveBeenCalledWith("course-1");
  });

  it("rejects unavailable curriculum before enrolment", async () => {
    const repository = {
      getCourseById: vi.fn(async () => null),
      getEnrolment: vi.fn(),
      enrol: vi.fn(),
    } as unknown as AcademyRepository;

    const h = harness(repository);
    const useCase = new EnrolInAcademyCourseUseCase(
      h.transactionManager,
      h.repositoryFactory,
    );

    await expect(
      useCase.execute("missing-course", claims),
    ).rejects.toBeInstanceOf(AcademyCourseUnavailableError);

    expect(repository.getEnrolment).not.toHaveBeenCalled();
    expect(repository.enrol).not.toHaveBeenCalled();
  });
});
