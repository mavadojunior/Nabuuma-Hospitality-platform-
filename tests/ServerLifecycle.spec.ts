import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { FastifyInstance } from "fastify";
import {
  RuntimeStateMachine,
} from "../src/runtime-health-state";
import {
  ServerLifecycle,
} from "../src/server-lifecycle";

function createApp(
  close: () => Promise<void>,
): FastifyInstance {
  return {
    close,
  } as unknown as FastifyInstance;
}

describe("ServerLifecycle", () => {
  it("marks not-ready before draining resources", async () => {
    const order: string[] = [];
    const runtime = new RuntimeStateMachine();

    const lifecycle = new ServerLifecycle({
      app: createApp(async () => {
        order.push(
          runtime.isReady()
            ? "http-ready"
            : "http-not-ready",
        );
      }),
      runtime,
      closeDatabase: async () => {
        order.push("database");
      },
      shutdownTimeoutMs: 5000,
    });

    lifecycle.markReady();
    await lifecycle.shutdown();

    expect(order).toEqual([
      "http-not-ready",
      "database",
    ]);
    expect(runtime.currentState()).toBe("STOPPED");
  });

  it("drains resources exactly once", async () => {
    const runtime = new RuntimeStateMachine();
    const closeHttp = vi.fn(async () => undefined);
    const closeDatabase =
      vi.fn(async () => undefined);

    const lifecycle = new ServerLifecycle({
      app: createApp(closeHttp),
      runtime,
      closeDatabase,
      shutdownTimeoutMs: 5000,
    });

    lifecycle.markReady();

    await Promise.all([
      lifecycle.shutdown(),
      lifecycle.shutdown(),
      lifecycle.shutdown(),
    ]);

    expect(closeHttp).toHaveBeenCalledOnce();
    expect(closeDatabase).toHaveBeenCalledOnce();
  });

  it("attempts database drain after HTTP failure", async () => {
    const runtime = new RuntimeStateMachine();
    const closeDatabase =
      vi.fn(async () => undefined);

    const lifecycle = new ServerLifecycle({
      app: createApp(async () => {
        throw new Error("HTTP close failed");
      }),
      runtime,
      closeDatabase,
      shutdownTimeoutMs: 5000,
    });

    lifecycle.markReady();

    await expect(
      lifecycle.shutdown(),
    ).rejects.toThrow("HTTP close failed");

    expect(closeDatabase).toHaveBeenCalledOnce();
    expect(runtime.currentState()).toBe(
      "SHUTTING_DOWN",
    );
  });

  it("does not mark stopped when the deadline expires before draining", async () => {
    const runtime = new RuntimeStateMachine();
    let resolveHttpClose!: () => void;
    const httpClose = new Promise<void>((resolve) => {
      resolveHttpClose = resolve;
    });
    const closeDatabase = vi.fn(async () => undefined);

    const lifecycle = new ServerLifecycle({
      app: createApp(() => httpClose),
      runtime,
      closeDatabase,
      shutdownTimeoutMs: 10,
    });

    lifecycle.markReady();

    await expect(lifecycle.shutdown()).rejects.toThrow(
      "Graceful shutdown timeout exceeded.",
    );
    expect(runtime.currentState()).toBe("SHUTTING_DOWN");
    expect(closeDatabase).not.toHaveBeenCalled();

    resolveHttpClose();
    await vi.waitFor(() => {
      expect(closeDatabase).toHaveBeenCalledOnce();
      expect(runtime.currentState()).toBe("STOPPED");
    });
  });

  it("preserves both shutdown failures", async () => {
    const runtime = new RuntimeStateMachine();

    const lifecycle = new ServerLifecycle({
      app: createApp(async () => {
        throw new Error("HTTP close failed");
      }),
      runtime,
      closeDatabase: async () => {
        throw new Error("database close failed");
      },
      shutdownTimeoutMs: 5000,
    });

    lifecycle.markReady();

    await expect(
      lifecycle.shutdown(),
    ).rejects.toBeInstanceOf(AggregateError);
  });
});
