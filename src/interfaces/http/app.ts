import Fastify, {
  type FastifyInstance,
} from "fastify";
import type { AcademyApplicationServices } from "../../bootstrap";
import {
  registerAcademyRoutes,
} from "./academy-routes";
import type { RequestAuthenticator } from "./authentication";
import {
  registerHealthRoutes,
  type HealthRouteDependencies,
} from "./health-routes";
import {
  registerCertificateVerificationRoutes,
  type CertificateVerifier,
} from "./certificate-verification-routes";

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
