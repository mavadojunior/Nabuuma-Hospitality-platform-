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
  JoseJwtVerifier,
  loadJwtAuthenticationConfig,
} from "./infrastructure/authentication/index.js";
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

export interface RuntimeFactories {
  readonly initializePool?: () => Pool;
  readonly closePool?: () => Promise<void>;
}

export async function createRuntime(
  environment: NodeJS.ProcessEnv = process.env,
  factories: RuntimeFactories = {},
): Promise<RuntimeProcess> {
  const config = loadRuntimeConfig(environment);
  const jwtConfig =
    loadJwtAuthenticationConfig(environment);

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

    const authenticator =
      new BearerRequestAuthenticator(
        new JoseJwtVerifier(jwtConfig),
      );

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
