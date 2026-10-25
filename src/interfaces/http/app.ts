import Fastify, {
  type FastifyInstance,
} from "fastify";
import type { AcademyApplicationServices } from "../../bootstrap.js";
import {
  registerAcademyRoutes,
} from "./academy-routes.js";
import type { RequestAuthenticator } from "./authentication.js";
import {
  registerHealthRoutes,
  type HealthRouteDependencies,
} from "./health-routes.js";
import {
  registerCertificateVerificationRoutes,
  type CertificateVerifier,
} from "./certificate-verification-routes.js";

export interface HttpApplicationDependencies {
  readonly academyServices: AcademyApplicationServices;
  readonly authenticator: RequestAuthenticator;
  readonly certificateVerifier?: CertificateVerifier;
  readonly health?: HealthRouteDependencies;
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

  if (dependencies.certificateVerifier) {
    await registerCertificateVerificationRoutes(
      app,
      dependencies.certificateVerifier,
    );
  }

  if (dependencies.health) {
    await registerHealthRoutes(
      app,
      dependencies.health,
    );
  }

  await app.ready();

  return app;
}
