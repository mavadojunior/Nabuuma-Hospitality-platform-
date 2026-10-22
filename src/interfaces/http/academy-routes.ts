import type { FastifyInstance } from "fastify";
import type { AcademyApplicationServices } from "../../bootstrap";
import type { RequestAuthenticator } from "./authentication";
import { mapHttpError } from "./errors";

interface CourseParams {
  courseId: string;
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
