import type { FastifyInstance } from "fastify";

export interface ReadinessProbe {
  isReady(): Promise<boolean>;
}

export interface RuntimeHealthState {
  isReady(): boolean;
}

export interface HealthRouteDependencies {
  readonly readiness: ReadinessProbe;
  readonly runtime: RuntimeHealthState;
}

export async function registerHealthRoutes(
  app: FastifyInstance,
  dependencies: HealthRouteDependencies,
): Promise<void> {
  app.get("/health/live", async (_request, reply) =>
    reply.code(200).send({
      status: "LIVE",
    }),
  );

  app.get("/health/ready", async (_request, reply) => {
    if (!dependencies.runtime.isReady()) {
      return reply.code(503).send({
        status: "NOT_READY",
      });
    }

    const databaseReady =
      await dependencies.readiness.isReady();

    if (
      !databaseReady ||
      !dependencies.runtime.isReady()
    ) {
      return reply.code(503).send({
        status: "NOT_READY",
      });
    }

    return reply.code(200).send({
      status: "READY",
    });
  });
}
