import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import Fastify, {
  type FastifyInstance,
} from "fastify";
import {
  generateKeyPair,
  SignJWT,
} from "jose";

import type {
  AcademyApplicationServices,
} from "../src/bootstrap.js";
import {
  BearerRequestAuthenticator,
} from "../src/infrastructure/authentication/BearerRequestAuthenticator.js";
import {
  JoseJwtVerifier,
} from "../src/infrastructure/authentication/JoseJwtVerifier.js";
import type {
  TokenClaims,
} from "../src/infrastructure/security/security.js";
import {
  registerMcpRoutes,
} from "../src/interfaces/mcp/mcp-routes.js";

interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id?: number;
  readonly result?: {
    readonly content?: ReadonlyArray<{
      readonly type: string;
      readonly text?: string;
    }>;
  };
  readonly error?: {
    readonly code: number;
    readonly message: string;
  };
}

const issuer =
  "https://identity.example.test";

const audience =
  "nabuuma-hospitality-mcp-test";

const tenantA =
  "22222222-2222-4222-8222-222222222222";

const tenantB =
  "33333333-3333-4333-8333-333333333333";

const userA =
  "11111111-1111-4111-8111-111111111111";

const userB =
  "44444444-4444-4444-8444-444444444444";

type GeneratedKeyPair =
  Awaited<ReturnType<typeof generateKeyPair>>;

type PrivateSigningKey =
  GeneratedKeyPair["privateKey"];

type PublicVerificationKey =
  GeneratedKeyPair["publicKey"];

let privateKey: PrivateSigningKey;
let publicKey: PublicVerificationKey;
let untrustedPrivateKey: PrivateSigningKey;

const observedClaims: TokenClaims[] = [];

const listCourses = vi.fn(
  async (claims: TokenClaims) => {
    observedClaims.push(claims);

    return [{
      id:
        "55555555-5555-4555-8555-555555555555",
      organisationId:
        claims.organisationId,
      stableKey:
        `academy.${claims.organisationId}`,
      version: 1,
      title: "Academy Course",
      description: "",
      isPublished: true,
      createdById: claims.subject,
      createdAt:
        new Date("2026-01-01T00:00:00.000Z"),
      updatedAt:
        new Date("2026-01-01T00:00:00.000Z"),
    }];
  },
);

const services = {
  listPublishedAcademyCoursesUseCase: {
    execute: listCourses,
  },
} as unknown as AcademyApplicationServices;

let app: FastifyInstance;
let origin: string;

function decodeMcpResponse(
  text: string,
): JsonRpcResponse {
  const trimmed = text.trim();

  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed) as JsonRpcResponse;
  }

  const dataLines = trimmed
    .split(/\r?\n/)
    .filter((line) =>
      line.startsWith("data:"),
    )
    .map((line) =>
      line.slice("data:".length).trim(),
    );

  if (dataLines.length !== 1) {
    throw new Error(
      `Expected one MCP message; received ${dataLines.length}.`,
    );
  }

  const payload = dataLines[0];

  if (!payload) {
    throw new Error(
      "MCP response contained an empty data event.",
    );
  }

  return JSON.parse(payload) as JsonRpcResponse;
}

async function token(options?: {
  readonly subject?: string;
  readonly organisationId?: string;
  readonly roles?: readonly string[];
  readonly issuer?: string;
  readonly audience?: string;
  readonly expiration?: number;
  readonly signingKey?: PrivateSigningKey;
}): Promise<string> {
  const now =
    Math.floor(Date.now() / 1000);

  return new SignJWT({
    organisation_id:
      options?.organisationId ?? tenantA,
    roles:
      options?.roles ?? ["LEARNER"],
  })
    .setProtectedHeader({
      alg: "RS256",
    })
    .setSubject(
      options?.subject ?? userA,
    )
    .setIssuer(
      options?.issuer ?? issuer,
    )
    .setAudience(
      options?.audience ?? audience,
    )
    .setIssuedAt(now)
    .setExpirationTime(
      options?.expiration ?? now + 120,
    )
    .sign(
      options?.signingKey ?? privateKey,
    );
}

async function callCourses(
  bearer?: string,
): Promise<{
  readonly status: number;
  readonly body: JsonRpcResponse | unknown;
}> {
  const headers = new Headers({
    accept:
      "application/json, text/event-stream",
    "content-type":
      "application/json",
  });

  if (bearer !== undefined) {
    headers.set(
      "authorization",
      `Bearer ${bearer}`,
    );
  }

  const response = await fetch(
    `${origin}/mcp`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name:
            "list_published_courses",
          arguments: {},
        },
      }),
    },
  );

  const text = await response.text();

  if (response.status !== 200) {
    return {
      status: response.status,
      body:
        text.length > 0
          ? JSON.parse(text)
          : {},
    };
  }

  return {
    status: response.status,
    body: decodeMcpResponse(text),
  };
}

beforeAll(async () => {
  const trusted =
    await generateKeyPair("RS256");

  privateKey = trusted.privateKey;
  publicKey = trusted.publicKey;

  const untrusted =
    await generateKeyPair("RS256");

  untrustedPrivateKey =
    untrusted.privateKey;

  const verifier =
    new JoseJwtVerifier(
      {
        issuer,
        audience,
        jwksUri:
          "https://identity.example.test/.well-known/jwks.json",
        algorithms: ["RS256"],
      },
      async () => publicKey,
    );

  const authenticator =
    new BearerRequestAuthenticator(
      verifier,
    );

  app = Fastify({
    logger: false,
  });

  await registerMcpRoutes(app, {
    services,
    authenticator,
  });

  await app.listen({
    host: "127.0.0.1",
    port: 0,
  });

  const address =
    app.server.address();

  if (
    !address ||
    typeof address === "string"
  ) {
    throw new Error(
      "MCP authentication server did not expose a TCP address.",
    );
  }

  origin =
    `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await app.close();
});

describe(
  "MCP JWT authentication",
  () => {
    it(
      "rejects a missing bearer token",
      async () => {
        const response =
          await callCourses();

        expect(response.status)
          .toBe(401);
      },
    );

    it(
      "rejects a token with an invalid signature",
      async () => {
        const accessToken =
          await token({
            signingKey:
              untrustedPrivateKey,
          });

        const response =
          await callCourses(
            accessToken,
          );

        expect(response.status)
          .toBe(401);
      },
    );

    it(
      "rejects an expired token",
      async () => {
        const accessToken =
          await token({
            expiration: 1,
          });

        const response =
          await callCourses(
            accessToken,
          );

        expect(response.status)
          .toBe(401);
      },
    );

    it(
      "rejects an incorrect issuer",
      async () => {
        const accessToken =
          await token({
            issuer:
              "https://wrong.example.test",
          });

        const response =
          await callCourses(
            accessToken,
          );

        expect(response.status)
          .toBe(401);
      },
    );

    it(
      "rejects an incorrect audience",
      async () => {
        const accessToken =
          await token({
            audience:
              "wrong-audience",
          });

        const response =
          await callCourses(
            accessToken,
          );

        expect(response.status)
          .toBe(401);
      },
    );

    it(
      "rejects an invalid organisation claim",
      async () => {
        const accessToken =
          await token({
            organisationId: "",
          });

        const response =
          await callCourses(
            accessToken,
          );

        expect(response.status)
          .toBe(401);
      },
    );

    it(
      "propagates only verified JWT identity to the Academy use case",
      async () => {
        observedClaims.length = 0;

        const accessToken =
          await token();

        const response =
          await callCourses(
            accessToken,
          );

        expect(response.status)
          .toBe(200);

        expect(observedClaims)
          .toEqual([{
            subject: userA,
            organisationId: tenantA,
            roles: ["LEARNER"],
          }]);
      },
    );

    it(
      "keeps concurrent tenant identities isolated",
      async () => {
        observedClaims.length = 0;

        const [
          tokenA,
          tokenB,
        ] = await Promise.all([
          token({
            subject: userA,
            organisationId: tenantA,
          }),
          token({
            subject: userB,
            organisationId: tenantB,
          }),
        ]);

        const responses =
          await Promise.all([
            callCourses(tokenA),
            callCourses(tokenB),
          ]);

        expect(
          responses.map(
            ({ status }) => status,
          ),
        ).toEqual([
          200,
          200,
        ]);

        expect(observedClaims)
          .toHaveLength(2);

        expect(
          new Set(
            observedClaims.map(
              (claims) =>
                `${claims.subject}|${claims.organisationId}`,
            ),
          ),
        ).toEqual(
          new Set([
            `${userA}|${tenantA}`,
            `${userB}|${tenantB}`,
          ]),
        );
      },
    );
  },
);
