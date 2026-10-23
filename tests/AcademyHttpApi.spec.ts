import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { FastifyInstance } from "fastify";
import type { AcademyApplicationServices } from "../src/bootstrap";
import { AcademyCourseUnavailableError } from "../src/application/academy";
import { createHttpApplication } from "../src/interfaces/http/app";
import type { RequestAuthenticator } from "../src/interfaces/http/authentication";

const claims = {
  subject: "11111111-1111-4111-8111-111111111111",
  organisationId: "22222222-2222-4222-8222-222222222222",
  roles: ["LEARNER"] as const,
};

const apps: FastifyInstance[] = [];

async function createHarness(overrides?: {
  list?: ReturnType<typeof vi.fn>;
  enrol?: ReturnType<typeof vi.fn>;
  authenticate?: ReturnType<typeof vi.fn>;
}) {
  const list = overrides?.list ?? vi.fn(async () => []);
  const enrol = overrides?.enrol ?? vi.fn();
  const authenticate =
    overrides?.authenticate ?? vi.fn(async () => claims);

  const academyServices = {
    listPublishedAcademyCoursesUseCase: {
      execute: list,
    },
    enrolInAcademyCourseUseCase: {
      execute: enrol,
    },
  } as unknown as AcademyApplicationServices;

  const authenticator = {
    authenticate,
  } as RequestAuthenticator;

  const app = await createHttpApplication({
    academyServices,
    authenticator,
  });

  apps.push(app);

  return {
    app,
    list,
    enrol,
    authenticate,
  };
}

afterEach(async () => {
  await Promise.all(
    apps.splice(0).map(async (app) => app.close()),
  );
});

describe("Academy HTTP API", () => {
  it("returns published courses using authenticated claims", async () => {
    const courses = [
      {
        id: "course-1",
        organisationId: claims.organisationId,
        stableKey: "espresso",
        version: 1,
        title: "Espresso",
        description: "",
        isPublished: true,
      },
    ];

    const list = vi.fn(async () => courses);
    const h = await createHarness({ list });

    const response = await h.app.inject({
      method: "GET",
      url: "/api/v1/academy/courses",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: courses,
    });
    expect(h.authenticate).toHaveBeenCalledOnce();
    expect(list).toHaveBeenCalledWith(claims);
  });

  it("enrols using only authenticated identity and the course path parameter", async () => {
    const enrolment = {
      id: "enrolment-1",
      organisationId: claims.organisationId,
      learnerId: claims.subject,
      courseId: "course-1",
      status: "ACTIVE",
      enrolledAt: "2026-10-22T00:00:00.000Z",
    };

    const enrol = vi.fn(async () => enrolment);
    const h = await createHarness({ enrol });

    const response = await h.app.inject({
      method: "POST",
      url: "/api/v1/academy/courses/course-1/enrolments",
      payload: {
        organisationId: "attacker-org",
        learnerId: "attacker-user",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      data: enrolment,
    });

    expect(enrol).toHaveBeenCalledWith(
      "course-1",
      claims,
    );
  });

  it("maps an unavailable course to 404", async () => {
    const enrol = vi.fn(async () => {
      throw new AcademyCourseUnavailableError();
    });

    const h = await createHarness({ enrol });

    const response = await h.app.inject({
      method: "POST",
      url: "/api/v1/academy/courses/missing/enrolments",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      code: "ACADEMY_COURSE_NOT_FOUND",
      message: "The requested Academy course is unavailable.",
    });
  });

  it("sanitises unexpected application failures", async () => {
    const list = vi.fn(async () => {
      throw new Error("database connection secret");
    });

    const h = await createHarness({ list });

    const response = await h.app.inject({
      method: "GET",
      url: "/api/v1/academy/courses",
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain(
      "database connection secret",
    );
    expect(response.json()).toEqual({
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
    });
  });

  it("does not call the use case when authentication fails", async () => {
    const authenticate = vi.fn(async () => {
      throw new Error("invalid bearer token");
    });

    const list = vi.fn();
    const h = await createHarness({
      authenticate,
      list,
    });

    const response = await h.app.inject({
      method: "GET",
      url: "/api/v1/academy/courses",
    });

    expect(response.statusCode).toBe(500);
    expect(list).not.toHaveBeenCalled();
    expect(response.body).not.toContain(
      "invalid bearer token",
    );
  });
});
