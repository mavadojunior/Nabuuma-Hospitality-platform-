import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { Pool } from "pg";
import {
  generateKeyPair,
  SignJWT,
} from "jose";
import {
  createRuntime,
  type RuntimeProcess,
} from "../src/runtime.js";
import {
  JoseJwtVerifier,
} from "../src/infrastructure/authentication/JoseJwtVerifier.js";

const databaseUrl =
  process.env.NABUUMA_TEST_DATABASE_URL;

const allowedDatabases = new Set([
  "nabuuma_test",
  "nabuuma_rls_test",
]);

const issuer = "https://identity.example.test";
const audience = "nabuuma-hospitality-test";
const subject = "11111111-1111-4111-8111-111111111111";
const organisationId =
  "22222222-2222-4222-8222-222222222222";

function validateDatabaseUrl(value: string): void {
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const database = decodeURIComponent(
    url.pathname.replace(/^\//, ""),
  );

  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("Test database URL must use PostgreSQL.");
  }

  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error("Integration tests may connect only to localhost.");
  }

  if (url.port !== "55433") {
    throw new Error("Integration tests require PostgreSQL port 55433.");
  }

  if (!allowedDatabases.has(database)) {
    throw new Error("Database is not on the integration-test allowlist.");
  }
}

const suite = describe.skipIf(!databaseUrl)(
  "Runtime authentication integration",
  () => {
    let pool: Pool | undefined;
    let runtime: RuntimeProcess | undefined;
    let privateKey: Awaited<
      ReturnType<typeof generateKeyPair>
    >["privateKey"];
    let publicKey: Awaited<
      ReturnType<typeof generateKeyPair>
    >["publicKey"];

    beforeAll(async () => {
      if (!databaseUrl) {
        throw new Error("Test database URL is missing.");
      }

      validateDatabaseUrl(databaseUrl);

      const keys = await generateKeyPair("RS256");
      privateKey = keys.privateKey;
      publicKey = keys.publicKey;

      pool = new Pool({
        connectionString: databaseUrl,
        max: 2,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 1000,
      });

      runtime = await createRuntime(
        {
          ...process.env,
          NODE_ENV: "test",
          HOST: "127.0.0.1",
          PORT: "3000",
          SHUTDOWN_TIMEOUT_MS: "10000",
          AUTH_JWT_ISSUER: issuer,
          AUTH_JWT_AUDIENCE: audience,
          AUTH_JWKS_URI:
            "https://identity.example.test/.well-known/jwks.json",
        },
        {
          initializePool: () => {
            if (!pool) {
              throw new Error("Test pool was not initialized.");
            }
            return pool;
          },
          closePool: async () => {
            await pool?.end();
          },
          createVerifier: (config) =>
            new JoseJwtVerifier(
              config,
              async () => publicKey,
            ),
        },
      );

      runtime.lifecycle.markReady();
    }, 15000);

    afterAll(async () => {
      if (runtime) {
        await runtime.lifecycle.shutdown();
      } else if (pool) {
        await pool.end();
      }
    }, 15000);

    async function token(options?: {
      issuer?: string;
      audience?: string;
      expiresAt?: number;
    }): Promise<string> {
      if (!privateKey) {
        throw new Error("Signing key is not initialized.");
      }

      const now = Math.floor(Date.now() / 1000);

      return new SignJWT({
        organisation_id: organisationId,
        roles: ["LEARNER"],
      })
        .setProtectedHeader({ alg: "RS256" })
        .setIssuer(options?.issuer ?? issuer)
        .setAudience(options?.audience ?? audience)
        .setSubject(subject)
        .setIssuedAt(now)
        .setExpirationTime(options?.expiresAt ?? now + 120)
        .sign(privateKey);
    }

    it("serves live and ready health checks", async () => {
      if (!runtime) {
        throw new Error("Runtime was not initialized.");
      }

      const live = await runtime.app.inject({
        method: "GET",
        url: "/health/live",
      });

      const ready = await runtime.app.inject({
        method: "GET",
        url: "/health/ready",
      });

      expect(live.statusCode).toBe(200);
      expect(live.json()).toEqual({ status: "LIVE" });

      expect(ready.statusCode).toBe(200);
      expect(ready.json()).toEqual({ status: "READY" });
    });

    it("rejects requests without a bearer token", async () => {
      if (!runtime) {
        throw new Error("Runtime was not initialized.");
      }

      const response = await runtime.app.inject({
        method: "GET",
        url: "/api/v1/academy/courses",
      });

      expect(response.statusCode).toBe(401);
    });

    it("rejects malformed bearer tokens", async () => {
      if (!runtime) {
        throw new Error("Runtime was not initialized.");
      }

      const response = await runtime.app.inject({
        method: "GET",
        url: "/api/v1/academy/courses",
        headers: {
          authorization: "Bearer not-a-valid-jwt",
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it.each([
      ["wrong issuer", { issuer: "https://wrong.example.test" }],
      ["wrong audience", { audience: "wrong-audience" }],
      ["expired token", { expiresAt: 1 }],
    ])("rejects a token with %s", async (_label, options) => {
      if (!runtime) {
        throw new Error("Runtime was not initialized.");
      }

      const accessToken = await token(options);

      const response = await runtime.app.inject({
        method: "GET",
        url: "/api/v1/academy/courses",
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it("authenticates a signed token and reaches the course repository", async () => {
      if (!runtime) {
        throw new Error("Runtime was not initialized.");
      }

      const accessToken = await token();

      const response = await runtime.app.inject({
        method: "GET",
        url: "/api/v1/academy/courses",
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json() as {
        data: Array<{
          organisationId: string;
          isPublished: boolean;
        }>;
      };

      expect(Array.isArray(body.data)).toBe(true);

      for (const course of body.data) {
        expect(course.organisationId).toBe(organisationId);
        expect(course.isPublished).toBe(true);
      }
    });
  },
);

void suite;
