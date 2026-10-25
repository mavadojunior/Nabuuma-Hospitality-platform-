import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { FastifyInstance } from "fastify";
import type { AcademyApplicationServices } from "../src/bootstrap";
import {
  AcademyCourseUnavailableError,
  InvalidAcademyLessonProgressError,
} from "../src/application/academy";
import {
  DomainConstraintError,
} from "../src/domain/competency/errors";
import { AuthenticationError } from "../src/infrastructure/authentication/errors";
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
  listLessons?: ReturnType<typeof vi.fn>;
  updateProgress?: ReturnType<typeof vi.fn>;
  listCertificates?: ReturnType<typeof vi.fn>;
  getCertificate?: ReturnType<typeof vi.fn>;
  completeCourse?: ReturnType<typeof vi.fn>;
  revokeCertificate?: ReturnType<typeof vi.fn>;
  authenticate?: ReturnType<typeof vi.fn>;
}) {
  const list = overrides?.list ?? vi.fn(async () => []);
  const enrol = overrides?.enrol ?? vi.fn();
  const listLessons =
    overrides?.listLessons ?? vi.fn(async () => []);
  const updateProgress =
    overrides?.updateProgress ?? vi.fn();
  const listCertificates =
    overrides?.listCertificates ?? vi.fn(async () => []);
  const getCertificate =
    overrides?.getCertificate ?? vi.fn();
  const completeCourse =
    overrides?.completeCourse ?? vi.fn();
  const revokeCertificate =
    overrides?.revokeCertificate ?? vi.fn();
  const authenticate =
    overrides?.authenticate ?? vi.fn(async () => claims);

  const academyServices = {
    listPublishedAcademyCoursesUseCase: {
      execute: list,
    },
    enrolInAcademyCourseUseCase: {
      execute: enrol,
    },
    listAcademyLessonsUseCase: {
      execute: listLessons,
    },
    updateAcademyLessonProgressUseCase: {
      execute: updateProgress,
    },
    listAcademyCertificatesUseCase: {
      execute: listCertificates,
    },
    getAcademyCertificateUseCase: {
      execute: getCertificate,
    },
    completeAcademyCourseUseCase: {
      execute: completeCourse,
    },
    revokeAcademyCertificateUseCase: {
      execute: revokeCertificate,
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
    listLessons,
    updateProgress,
    listCertificates,
    getCertificate,
    completeCourse,
    revokeCertificate,
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

  it("returns published lessons using authenticated claims", async () => {
    const lessons = [
      {
        id: "lesson-1",
        organisationId: claims.organisationId,
        courseId: "course-1",
        stableKey: "espresso-basics",
        title: "Espresso basics",
        content: {},
        sequenceNumber: 1,
        isPublished: true,
      },
    ];

    const listLessons = vi.fn(async () => lessons);
    const h = await createHarness({ listLessons });

    const response = await h.app.inject({
      method: "GET",
      url: "/api/v1/academy/courses/course-1/lessons",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: lessons,
    });

    expect(h.authenticate).toHaveBeenCalledOnce();
    expect(listLessons).toHaveBeenCalledWith(
      "course-1",
      claims,
    );
  });

  it("updates lesson progress using authenticated identity", async () => {
    const progress = {
      id: "progress-1",
      organisationId: claims.organisationId,
      learnerId: claims.subject,
      courseId: "course-1",
      enrolmentId: "enrolment-1",
      lessonId: "lesson-1",
      status: "IN_PROGRESS",
      progressPercent: 50,
      lastActivityAt: "2026-10-22T00:00:00.000Z",
    };

    const updateProgress = vi.fn(async () => progress);
    const h = await createHarness({ updateProgress });

    const response = await h.app.inject({
      method: "PUT",
      url:
        "/api/v1/academy/courses/course-1/" +
        "enrolments/enrolment-1/lessons/lesson-1/progress",
      payload: {
        status: "IN_PROGRESS",
        progressPercent: 50,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: progress,
    });

    expect(h.authenticate).toHaveBeenCalledOnce();

    expect(updateProgress).toHaveBeenCalledWith(
      {
        courseId: "course-1",
        enrolmentId: "enrolment-1",
        lessonId: "lesson-1",
        status: "IN_PROGRESS",
        progressPercent: 50,
      },
      claims,
    );
  });

  it("maps invalid lesson progress to 400", async () => {
    const updateProgress = vi.fn(async () => {
      throw new InvalidAcademyLessonProgressError();
    });

    const h = await createHarness({ updateProgress });

    const response = await h.app.inject({
      method: "PUT",
      url:
        "/api/v1/academy/courses/course-1/" +
        "enrolments/enrolment-1/lessons/lesson-1/progress",
      payload: {
        status: "IN_PROGRESS",
        progressPercent: 100,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: "INVALID_ACADEMY_LESSON_PROGRESS",
      message:
        "The Academy lesson progress transition is invalid.",
    });
  });

  it("rejects identity injection in the progress request body", async () => {
    const updateProgress = vi.fn();

    const h = await createHarness({ updateProgress });

    const response = await h.app.inject({
      method: "PUT",
      url:
        "/api/v1/academy/courses/course-1/" +
        "enrolments/enrolment-1/lessons/lesson-1/progress",
      payload: {
        status: "IN_PROGRESS",
        progressPercent: 50,
        organisationId: "attacker-org",
        learnerId: "attacker-user",
      },
    });

    expect(response.statusCode).toBe(400);

    expect(h.authenticate).not.toHaveBeenCalled();
    expect(updateProgress).not.toHaveBeenCalled();
  });

  it("revokes a certificate using authenticated claims", async () => {
    const revocation = {
      certificateNumber: "NAB-TEST",
      revokedAt: "2026-10-25T05:00:00.000Z",
      newlyRevoked: true,
    };

    const revokeCertificate = vi.fn(
      async () => revocation,
    );

    const h = await createHarness({
      revokeCertificate,
    });

    const response = await h.app.inject({
      method: "POST",
      url:
        "/api/v1/academy/certificates/" +
        "NAB-TEST/revocation",
      payload: {
        reason: "  Issued in error  ",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: revocation,
    });

    expect(h.authenticate).toHaveBeenCalledOnce();
    expect(revokeCertificate).toHaveBeenCalledWith(
      {
        certificateNumber: "NAB-TEST",
        reason: "Issued in error",
      },
      claims,
    );
  });

  it("rejects malformed revocation requests before authentication", async () => {
    const revokeCertificate = vi.fn();
    const h = await createHarness({
      revokeCertificate,
    });

    const response = await h.app.inject({
      method: "POST",
      url:
        "/api/v1/academy/certificates/" +
        "invalid_number/revocation",
      payload: {
        reason: "   ",
        organisationId: "attacker-org",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(h.authenticate).not.toHaveBeenCalled();
    expect(revokeCertificate).not.toHaveBeenCalled();
  });

  it("maps a rejected certificate revocation to conflict", async () => {
    const revokeCertificate = vi.fn(async () => {
      throw new DomainConstraintError(
        "database detail must not leak",
      );
    });

    const h = await createHarness({
      revokeCertificate,
    });

    const response = await h.app.inject({
      method: "POST",
      url:
        "/api/v1/academy/certificates/" +
        "NAB-TEST/revocation",
      payload: {
        reason: "Issued in error",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      code: "CONFLICT",
      message:
        "The requested operation conflicts with existing state.",
    });

    expect(response.body).not.toContain(
      "database detail must not leak",
    );
  });

  it("requires authentication for certificate revocation", async () => {
    const authenticate = vi.fn(async () => {
      throw new AuthenticationError();
    });

    const revokeCertificate = vi.fn();

    const h = await createHarness({
      authenticate,
      revokeCertificate,
    });

    const response = await h.app.inject({
      method: "POST",
      url:
        "/api/v1/academy/certificates/" +
        "NAB-TEST/revocation",
      payload: {
        reason: "Issued in error",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      code: "UNAUTHENTICATED",
      message: "Authentication required.",
    });
    expect(revokeCertificate).not.toHaveBeenCalled();
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

  it("lists learner certificates using authenticated claims", async () => {
    const certificates = [
      {
        id: "certificate-1",
        organisationId: claims.organisationId,
        learnerId: claims.subject,
        courseId: "course-1",
        enrolmentId: "enrolment-1",
        certificateNumber: "NAB-TEST",
        issuedAt: "2026-10-24T00:00:00.000Z",
        metadata: {},
      },
    ];

    const listCertificates = vi.fn(async () => certificates);
    const h = await createHarness({ listCertificates });

    const response = await h.app.inject({
      method: "GET",
      url: "/api/v1/academy/certificates",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: certificates,
    });
    expect(h.authenticate).toHaveBeenCalledOnce();
    expect(listCertificates).toHaveBeenCalledWith(claims);
  });

  it("returns one learner certificate using authenticated claims", async () => {
    const certificate = {
      id: "certificate-1",
      organisationId: claims.organisationId,
      learnerId: claims.subject,
      courseId: "course-1",
      enrolmentId: "enrolment-1",
      certificateNumber: "NAB-TEST",
      issuedAt: "2026-10-24T00:00:00.000Z",
      metadata: {},
    };

    const getCertificate = vi.fn(async () => certificate);
    const h = await createHarness({ getCertificate });

    const response = await h.app.inject({
      method: "GET",
      url: "/api/v1/academy/certificates/certificate-1",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: certificate,
    });
    expect(getCertificate).toHaveBeenCalledWith(
      "certificate-1",
      claims,
    );
  });

  it("maps a missing learner certificate to 404", async () => {
    const {
      AcademyCertificateNotFoundError,
    } = await import("../src/application/academy");

    const getCertificate = vi.fn(async () => {
      throw new AcademyCertificateNotFoundError();
    });

    const h = await createHarness({ getCertificate });

    const response = await h.app.inject({
      method: "GET",
      url: "/api/v1/academy/certificates/missing",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      code: "ACADEMY_CERTIFICATE_NOT_FOUND",
      message: "The requested Academy certificate was not found.",
    });
  });

  it("completes an enrolment using authenticated identity", async () => {
    const certificate = {
      id: "certificate-1",
      organisationId: claims.organisationId,
      learnerId: claims.subject,
      courseId: "course-1",
      enrolmentId: "enrolment-1",
      certificateNumber: "NAB-TEST",
      issuedAt: "2026-10-24T00:00:00.000Z",
      metadata: {},
    };

    const completeCourse = vi.fn(async () => certificate);
    const h = await createHarness({ completeCourse });

    const response = await h.app.inject({
      method: "POST",
      url:
        "/api/v1/academy/courses/course-1/" +
        "enrolments/enrolment-1/completion",
      payload: {
        organisationId: "attacker-org",
        learnerId: "attacker-user",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: certificate,
    });

    expect(completeCourse).toHaveBeenCalledWith(
      "course-1",
      "enrolment-1",
      claims,
    );
  });

  it("does not call the use case when authentication fails", async () => {
    const authenticate = vi.fn(async () => {
      throw new AuthenticationError();
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

    expect(response.statusCode).toBe(401);
    expect(list).not.toHaveBeenCalled();
    expect(response.json()).toEqual({
      code: "UNAUTHENTICATED",
      message: "Authentication required.",
    });
  });
});
