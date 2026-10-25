import type { FastifyInstance } from "fastify";
import type {
  RuntimeStateMachine,
} from "./runtime-health-state";

export interface ServerLifecycleDependencies {
  readonly app: FastifyInstance;
  readonly runtime: RuntimeStateMachine;
  readonly closeDatabase: () => Promise<void>;
  readonly shutdownTimeoutMs: number;
}

export class ServerLifecycle {
  private shutdownPromise: Promise<void> | undefined;

  constructor(
    private readonly dependencies:
      ServerLifecycleDependencies,
  ) {
    if (
      !Number.isInteger(
        dependencies.shutdownTimeoutMs,
      ) ||
      dependencies.shutdownTimeoutMs < 1
    ) {
      throw new Error(
        "shutdownTimeoutMs must be a positive integer.",
      );
    }
  }

  markReady(): void {
    this.dependencies.runtime.markReady();
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.dependencies.runtime.beginShutdown();
    this.shutdownPromise = this.shutdownWithinDeadline();

    return this.shutdownPromise;
  }

  private async shutdownWithinDeadline(): Promise<void> {
    let timeout: NodeJS.Timeout | undefined;

    const deadline = new Promise<never>(
      (_resolve, reject) => {
        timeout = setTimeout(
          () => reject(
            new Error(
              "Graceful shutdown timeout exceeded.",
            ),
          ),
          this.dependencies.shutdownTimeoutMs,
        );

        timeout.unref();
      },
    );

    try {
      await Promise.race([
        this.drainResources(),
        deadline,
      ]);

      this.dependencies.runtime.markStopped();
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  private async drainResources(): Promise<void> {
    const failures: unknown[] = [];

    try {
      await this.dependencies.app.close();
    } catch (error) {
      failures.push(error);
    }

    try {
      await this.dependencies.closeDatabase();
    } catch (error) {
      failures.push(error);
    }

    if (failures.length === 1) {
      throw failures[0];
    }

    if (failures.length > 1) {
      throw new AggregateError(
        failures,
        "HTTP and database shutdown failed.",
      );
    }
  }
}
