import Fastify, {
  type FastifyInstance,
} from "fastify";
import type { AcademyApplicationServices } from "../../bootstrap";
import {
  registerAcademyRoutes,
} from "./academy-routes";
import type { RequestAuthenticator } from "./authentication";

export interface HttpApplicationDependencies {
  readonly academyServices: AcademyApplicationServices;
  readonly authenticator: RequestAuthenticator;
}

export async function createHttpApplication(
  dependencies: HttpApplicationDependencies,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    ajv: {
      customOptions: {
        removeAdditional: false,
      },
    },
  });

  await registerAcademyRoutes(app, {
    services: dependencies.academyServices,
    authenticator: dependencies.authenticator,
  });

  await app.ready();

  return app;
}
