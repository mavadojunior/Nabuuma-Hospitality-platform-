import type { FastifyInstance } from "fastify";
import type { AcademyApplicationServices } from "../../bootstrap.js";
import type { AcademyLessonProgressStatus } from "../../domain/academy/index.js";
import type { RequestAuthenticator } from "./authentication.js";
import { mapHttpError } from "./errors.js";

interface CourseParams {
  courseId: string;
}

interface CertificateParams {
  certificateId: string;
}

interface CertificateRevocationParams {
  certificateNumber: string;
}

interface CertificateRevocationBody {
  reason: string;
}

interface CourseEnrolmentParams extends CourseParams {
  enrolmentId: string;
}

interface LessonProgressParams extends CourseEnrolmentParams {
  lessonId: string;
}

interface LessonProgressBody {
  status: AcademyLessonProgressStatus;
  progressPercent: number;
}

export interface AcademyRouteDependencies {
  readonly services: AcademyApplicationServices;
  readonly authenticator: RequestAuthenticator;
}

export async function registerAcademyRoutes(
  app: FastifyInstance,
  dependencies: AcademyRouteDependencies,
): Promise<void> {
  app.get(
    "/api/v1/academy/courses",
    async (request, reply) => {
      try {
        const claims =
          await dependencies.authenticator.authenticate(request);

        const courses =
          await dependencies.services
            .listPublishedAcademyCoursesUseCase
            .execute(claims);

        return reply.code(200).send({
          data: courses,
        });
      } catch (error) {
        const mapped = mapHttpError(error);
        return reply.code(mapped.statusCode).send(mapped.body);
      }
    },
  );

  app.get(
    "/api/v1/academy/certificates",
    async (request, reply) => {
      try {
        const claims =
          await dependencies.authenticator.authenticate(request);

        const certificates =
          await dependencies.services
            .listAcademyCertificatesUseCase
            .execute(claims);

        return reply.code(200).send({
          data: certificates,
        });
      } catch (error) {
        const mapped = mapHttpError(error);
        return reply.code(mapped.statusCode).send(mapped.body);
      }
    },
  );

  app.get<{ Params: CertificateParams }>(
    "/api/v1/academy/certificates/:certificateId",
    async (request, reply) => {
      try {
        const claims =
          await dependencies.authenticator.authenticate(request);

        const certificate =
          await dependencies.services
            .getAcademyCertificateUseCase
            .execute(
              request.params.certificateId,
              claims,
            );

        return reply.code(200).send({
          data: certificate,
        });
      } catch (error) {
        const mapped = mapHttpError(error);
        return reply.code(mapped.statusCode).send(mapped.body);
      }
    },
  );

  app.post<{
    Params: CertificateRevocationParams;
    Body: CertificateRevocationBody;
  }>(
    "/api/v1/academy/certificates/:certificateNumber/revocation",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["certificateNumber"],
          properties: {
            certificateNumber: {
              type: "string",
              pattern: "^NAB-[A-Za-z0-9-]+$",
              minLength: 5,
              maxLength: 200,
            },
          },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["reason"],
          properties: {
            reason: {
              type: "string",
              minLength: 1,
              maxLength: 1000,
              pattern: ".*\\S.*",
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const claims =
          await dependencies.authenticator.authenticate(request);

        const revocation =
          await dependencies.services
            .revokeAcademyCertificateUseCase
            .execute(
              {
                certificateNumber:
                  request.params.certificateNumber,
                reason: request.body.reason.trim(),
              },
              claims,
            );

        return reply.code(200).send({
          data: revocation,
        });
      } catch (error) {
        const mapped = mapHttpError(error);
        return reply.code(mapped.statusCode).send(mapped.body);
      }
    },
  );

  app.get<{ Params: CourseParams }>(
    "/api/v1/academy/courses/:courseId/lessons",
    async (request, reply) => {
      try {
        const claims =
          await dependencies.authenticator.authenticate(request);

        const lessons =
          await dependencies.services
            .listAcademyLessonsUseCase
            .execute(request.params.courseId, claims);

        return reply.code(200).send({
          data: lessons,
        });
      } catch (error) {
        const mapped = mapHttpError(error);
        return reply.code(mapped.statusCode).send(mapped.body);
      }
    },
  );

  app.put<{
    Params: LessonProgressParams;
    Body: LessonProgressBody;
  }>(
    "/api/v1/academy/courses/:courseId/enrolments/:enrolmentId/lessons/:lessonId/progress",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["status", "progressPercent"],
          properties: {
            status: {
              type: "string",
              enum: [
                "NOT_STARTED",
                "IN_PROGRESS",
                "COMPLETED",
              ],
            },
            progressPercent: {
              type: "integer",
              minimum: 0,
              maximum: 100,
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const claims =
          await dependencies.authenticator.authenticate(request);

        const progress =
          await dependencies.services
            .updateAcademyLessonProgressUseCase
            .execute(
              {
                courseId: request.params.courseId,
                enrolmentId: request.params.enrolmentId,
                lessonId: request.params.lessonId,
                status: request.body.status,
                progressPercent: request.body.progressPercent,
              },
              claims,
            );

        return reply.code(200).send({
          data: progress,
        });
      } catch (error) {
        const mapped = mapHttpError(error);
        return reply.code(mapped.statusCode).send(mapped.body);
      }
    },
  );

  app.post<{ Params: CourseEnrolmentParams }>(
    "/api/v1/academy/courses/:courseId/enrolments/:enrolmentId/completion",
    async (request, reply) => {
      try {
        const claims =
          await dependencies.authenticator.authenticate(request);

        const certificate =
          await dependencies.services
            .completeAcademyCourseUseCase
            .execute(
              request.params.courseId,
              request.params.enrolmentId,
              claims,
            );

        return reply.code(200).send({
          data: certificate,
        });
      } catch (error) {
        const mapped = mapHttpError(error);
        return reply.code(mapped.statusCode).send(mapped.body);
      }
    },
  );

  app.post<{ Params: CourseParams }>(
    "/api/v1/academy/courses/:courseId/enrolments",
    async (request, reply) => {
      try {
        const claims =
          await dependencies.authenticator.authenticate(request);

        const enrolment =
          await dependencies.services
            .enrolInAcademyCourseUseCase
            .execute(request.params.courseId, claims);

        return reply.code(201).send({
          data: enrolment,
        });
      } catch (error) {
        const mapped = mapHttpError(error);
        return reply.code(mapped.statusCode).send(mapped.body);
      }
    },
  );
}
