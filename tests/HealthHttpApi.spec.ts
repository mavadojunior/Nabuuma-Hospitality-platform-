import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { FastifyInstance } from "fastify";
import type {
  AcademyApplicationServices,
} from "../src/bootstrap";
import {
  createHttpApplication,
} from "../src/interfaces/http/app";
import type {
  RequestAuthenticator,
} from "../src/interfaces/http/authentication";

const apps: FastifyInstance[] = [];

async function createHarness(
  databaseReady: boolean,
  shuttingDown = false,
) {
  const isReady = vi.fn(async () => databaseReady);
  const isShuttingDown = vi.fn(() => shuttingDown);

  const app = await createHttpApplication({
    academyServices: {} as AcademyApplicationServices,
    authenticator: {
      authenticate: vi.fn(),
    } as unknown as RequestAuthenticator,
    health: {
      readiness: {
        isReady,
      },
      runtime: {
        isShuttingDown,
      },
    },
  });

  apps.push(app);

  return {
    app,
    isReady,
    isShuttingDown,
  };
}

afterEach(async () => {
  await Promise.all(
    apps.splice(0).map(async (app) => app.close()),
  );
});

describe("HTTP health probes", () => {
  it("reports liveness without checking dependencies", async () => {
    const h = await createHarness(false);

    const response = await h.app.inject({
      method: "GET",
      url: "/health/live",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "LIVE",
    });
    expect(h.isReady).not.toHaveBeenCalled();
  });

  it("reports readiness when the database is healthy", async () => {
    const h = await createHarness(true);

    const response = await h.app.inject({
      method: "GET",
      url: "/health/ready",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "READY",
    });
    expect(h.isReady).toHaveBeenCalledOnce();
  });

  it("rejects readiness when the database is unavailable", async () => {
    const h = await createHarness(false);

    const response = await h.app.inject({
      method: "GET",
      url: "/health/ready",
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: "NOT_READY",
    });
  });

  it("rejects readiness immediately during shutdown", async () => {
    const h = await createHarness(true, true);

    const response = await h.app.inject({
      method: "GET",
      url: "/health/ready",
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: "NOT_READY",
    });

    expect(h.isReady).not.toHaveBeenCalled();
  });
});
