import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import {
  createAcademyApplicationServices,
  createTransactionManager,
} from "./bootstrap.js";
import {
  closeDatabasePool,
  initializeDatabasePool,
} from "./infrastructure/database/connection.js";
import {
  PgCertificateVerifier,
} from "./infrastructure/database/PgCertificateVerifier.js";
import {
  PgReadinessProbe,
} from "./infrastructure/database/PgReadinessProbe.js";
import {
  BearerRequestAuthenticator,
  Auth0RequestAuthenticator,
  ExternalIdentityResolver,
  PgExternalIdentityRepository,
  JoseJwtVerifier,
  loadAuthenticationProviderConfig,
} from "./infrastructure/authentication/index.js";
import type {
  AccessTokenVerifier,
  VerifiedJwtPayloadVerifier,
} from "./infrastructure/authentication/JoseJwtVerifier.js";
import type {
  JwtAuthenticationConfig,
} from "./infrastructure/authentication/config.js";
import {
  createHttpApplication,
} from "./interfaces/http/app.js";
import {
  loadRuntimeConfig,
  type RuntimeConfig,
} from "./runtime-config.js";
import {
  RuntimeStateMachine,
} from "./runtime-health-state.js";
import {
  ServerLifecycle,
} from "./server-lifecycle.js";

export interface RuntimeProcess {
  readonly app: FastifyInstance;
  readonly lifecycle: ServerLifecycle;
  readonly config: RuntimeConfig;
}

export function createRuntimeAuthenticator(
  authConfig: ReturnType<typeof loadAuthenticationProviderConfig>,
  pool: Pool,
  factories: RuntimeFactories = {},
) {
  if (authConfig.provider === "SUPABASE") {
    return new BearerRequestAuthenticator(
      factories.createVerifier?.(authConfig.jwt) ??
        new JoseJwtVerifier(authConfig.jwt),
    );
  }

  return new Auth0RequestAuthenticator(
    factories.createAuth0Verifier?.(authConfig.jwt) ??
      new JoseJwtVerifier(authConfig.jwt),
    new ExternalIdentityResolver(
      new PgExternalIdentityRepository(pool),
    ),
  );
}

export interface RuntimeFactories {
  readonly initializePool?: () => Pool;
  readonly closePool?: () => Promise<void>;
  readonly createVerifier?: (
    config: JwtAuthenticationConfig,
  ) => AccessTokenVerifier;
  readonly createAuth0Verifier?: (
    config: JwtAuthenticationConfig,
  ) => VerifiedJwtPayloadVerifier;
}

export async function createRuntime(
  environment: NodeJS.ProcessEnv = process.env,
  factories: RuntimeFactories = {},
): Promise<RuntimeProcess> {
  const config = loadRuntimeConfig(environment);
  const authConfig =
    loadAuthenticationProviderConfig(environment);

  const initializePool =
    factories.initializePool ?? initializeDatabasePool;
  const closePool =
    factories.closePool ?? closeDatabasePool;

  const pool = initializePool();
  const runtime = new RuntimeStateMachine();

  try {
    const readiness = new PgReadinessProbe(pool);

    if (!(await readiness.isReady())) {
      throw new Error(
        "PostgreSQL readiness probe failed during startup.",
      );
    }

    const transactionManager =
      createTransactionManager(pool);

    const academyServices =
      createAcademyApplicationServices(
        transactionManager,
      );

    const authenticator = createRuntimeAuthenticator(authConfig, pool, factories);

    const certificateVerifier =
      new PgCertificateVerifier(pool);

    const app = await createHttpApplication({
      academyServices,
      authenticator,
      certificateVerifier,
      health: {
        readiness,
        runtime,
      },
    });

    const lifecycle = new ServerLifecycle({
      app,
      runtime,
      closeDatabase: closePool,
      shutdownTimeoutMs:
        config.shutdownTimeoutMs,
    });

    return {
      app,
      lifecycle,
      config,
    };
  } catch (error) {
    runtime.beginShutdown();

    try {
      await closePool();
    } catch {
      // Preserve the startup failure as the primary error.
    }

    throw error;
  }
}
