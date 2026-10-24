import type { FastifyInstance } from "fastify";
import type { AcademyApplicationServices } from "../../bootstrap";
import type { AcademyLessonProgressStatus } from "../../domain/academy";
import type { RequestAuthenticator } from "./authentication";
import { mapHttpError } from "./errors";

interface CourseParams {
  courseId: string;
}

interface CertificateParams {
  certificateId: string;
}

interface LessonProgressParams extends CourseParams {
  enrolmentId: string;
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
