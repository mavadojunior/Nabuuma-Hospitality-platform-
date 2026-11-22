import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  request as httpRequest,
} from "node:http";
import Fastify, {
  type FastifyInstance,
} from "fastify";

import type {
  AcademyApplicationServices,
} from "../src/bootstrap.js";
import {
  AuthenticationError,
} from "../src/infrastructure/authentication/errors.js";
import type {
  TokenClaims,
} from "../src/infrastructure/security/security.js";
import type {
  RequestAuthenticator,
} from "../src/interfaces/http/authentication.js";
import {
  registerMcpRoutes,
} from "../src/interfaces/mcp/mcp-routes.js";

interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id?: number;
  readonly result?: {
    readonly tools?: ReadonlyArray<{
      readonly name: string;
      readonly description?: string;
      readonly inputSchema?: unknown;
    }>;
    readonly content?: ReadonlyArray<{
      readonly type: string;
      readonly text?: string;
    }>;
    readonly isError?: boolean;
  };
  readonly error?: {
    readonly code: number;
    readonly message: string;
  };
}

const claims: TokenClaims = {
  subject:
    "11111111-1111-4111-8111-111111111111",
  organisationId:
    "22222222-2222-4222-8222-222222222222",
  roles: ["LEARNER"],
};

const listCourses = vi.fn(async () => [
  {
    id: "33333333-3333-4333-8333-333333333333",
    organisationId: claims.organisationId,
    stableKey: "academy.security",
    version: 1,
    title: "Academy Security",
    description: "Security course",
    isPublished: true,
    createdById: claims.subject,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  },
]);

const listLessons = vi.fn(async () => [
  {
    id: "44444444-4444-4444-8444-444444444444",
    organisationId: claims.organisationId,
    courseId:
      "33333333-3333-4333-8333-333333333333",
    stableKey: "academy.security.lesson",
    title: "Tenant Isolation",
    content: {},
    sequenceNumber: 1,
    estimatedDurationMinutes: 15,
    isPublished: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  },
]);

const listCertificates = vi.fn(async () => [
  {
    id: "55555555-5555-4555-8555-555555555555",
    organisationId: claims.organisationId,
    learnerId: claims.subject,
    courseId:
      "33333333-3333-4333-8333-333333333333",
    certificateNumber: "NAB-TEST-001",
    issuedAt: new Date("2026-01-02T00:00:00.000Z"),
  },
]);

const getCertificate = vi.fn(
  async (certificateId: string) => ({
    id: certificateId,
    organisationId: claims.organisationId,
    learnerId: claims.subject,
    courseId:
      "33333333-3333-4333-8333-333333333333",
    certificateNumber: "NAB-TEST-001",
    issuedAt: new Date("2026-01-02T00:00:00.000Z"),
  }),
);

const enrol = vi.fn(
  async (courseId: string) => ({
    id: "66666666-6666-4666-8666-666666666666",
    organisationId: claims.organisationId,
    learnerId: claims.subject,
    courseId,
    status: "ACTIVE",
    enrolledAt: "2026-01-03T00:00:00.000Z",
  }),
);

const services = {
  listPublishedAcademyCoursesUseCase: {
    execute: listCourses,
  },
  listAcademyLessonsUseCase: {
    execute: listLessons,
  },
  listAcademyCertificatesUseCase: {
    execute: listCertificates,
  },
  getAcademyCertificateUseCase: {
    execute: getCertificate,
  },
  enrolInAcademyCourseUseCase: {
    execute: enrol,
  },
} as unknown as AcademyApplicationServices;

const authenticator: RequestAuthenticator = {
  authenticate: vi.fn(async (request) => {
    if (
      request.headers.authorization !==
      "Bearer test-token"
    ) {
      throw new AuthenticationError();
    }

    return claims;
  }),
};

let app: FastifyInstance;
let origin: string;

async function rawHttpPost(
  host: string,
  body: unknown,
): Promise<{
  readonly status: number;
  readonly body: string;
}> {
  const endpoint =
    new URL("/mcp", origin);
  const payload =
    JSON.stringify(body);

  return new Promise(
    (resolve, reject) => {
      const request = httpRequest(
        {
          hostname: endpoint.hostname,
          port: endpoint.port,
          path: endpoint.pathname,
          method: "POST",
          headers: {
            accept:
              "application/json, text/event-stream",
            authorization:
              "Bearer test-token",
            "content-type":
              "application/json",
            "content-length":
              Buffer.byteLength(payload),
            host,
          },
        },
        (response) => {
          const chunks: Buffer[] = [];

          response.on(
            "data",
            (chunk: Buffer) => {
              chunks.push(chunk);
            },
          );

          response.on(
            "end",
            () => {
              resolve({
                status:
                  response.statusCode ?? 0,
                body:
                  Buffer.concat(chunks)
                    .toString("utf8"),
              });
            },
          );
        },
      );

      request.once(
        "error",
        reject,
      );

      request.end(payload);
    },
  );
}

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
      `Expected exactly one MCP message; received ${dataLines.length}.`,
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

async function mcp(
  body: unknown,
  authorization?: string,
): Promise<{
  readonly status: number;
  readonly body: JsonRpcResponse;
}> {
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  });

  if (authorization !== undefined) {
    headers.set(
      "authorization",
      authorization,
    );
  }

  const response = await fetch(`${origin}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const text = await response.text();

  return {
    status: response.status,
    body: decodeMcpResponse(text),
  };
}

beforeAll(async () => {
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

  const address = app.server.address();

  if (
    !address ||
    typeof address === "string"
  ) {
    throw new Error(
      "MCP test server did not expose a TCP address.",
    );
  }

  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await app.close();
});

describe("authenticated MCP HTTP transport", () => {
  it("rejects a non-loopback Host before authentication or MCP delegation", async () => {
    const response =
      await rawHttpPost(
        "evil.example",
        {
          jsonrpc: "2.0",
          id: 98,
          method: "tools/list",
        },
      );

    expect(response.status).toBe(403);
  });

  it("rejects a non-loopback Origin before authentication or MCP delegation", async () => {
    const response = await fetch(`${origin}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        authorization: "Bearer test-token",
        "content-type": "application/json",
        origin: "https://evil.example",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 99,
        method: "tools/list",
      }),
    });

    expect(response.status).toBe(403);
  });

  it("rejects a missing bearer token before MCP protocol handling", async () => {
    const response = await fetch(`${origin}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 100,
        method: "tools/list",
      }),
    });

    expect(response.status).toBe(401);
  });

  it("rejects a malformed bearer token before MCP protocol handling", async () => {
    const response = await fetch(`${origin}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        authorization: "Bearer malformed-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 101,
        method: "tools/list",
      }),
    });

    expect(response.status).toBe(401);
  });

  it("discovers the five Academy tools", async () => {
    const response = await mcp({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    }, "Bearer test-token");

    expect(response.status).toBe(200);
    expect(response.body.error).toBeUndefined();

    expect(
      response.body.result?.tools?.map(
        ({ name }) => name,
      ),
    ).toEqual([
      "list_published_courses",
      "list_course_lessons",
      "list_academy_certificates",
      "get_academy_certificate",
      "enrol_in_academy_course",
    ]);
  });

  it("invokes list_published_courses with trusted claims", async () => {
    listCourses.mockClear();

    const response = await mcp({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "list_published_courses",
        arguments: {},
      },
    }, "Bearer test-token");

    expect(response.status).toBe(200);
    expect(response.body.error).toBeUndefined();
    expect(listCourses).toHaveBeenCalledExactlyOnceWith(
      claims,
    );

    const text =
      response.body.result?.content?.[0]?.text;

    expect(JSON.parse(text ?? "{}")).toMatchObject({
      data: [{
        organisationId: claims.organisationId,
        isPublished: true,
      }],
    });
  });

  it("invokes list_course_lessons with a validated course identifier", async () => {
    listLessons.mockClear();

    const courseId =
      "33333333-3333-4333-8333-333333333333";

    const response = await mcp({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "list_course_lessons",
        arguments: {
          courseId,
        },
      },
    }, "Bearer test-token");

    expect(response.status).toBe(200);
    expect(response.body.error).toBeUndefined();
    expect(listLessons).toHaveBeenCalledExactlyOnceWith(
      courseId,
      claims,
    );
  });

  it("rejects invalid list_course_lessons arguments before use-case execution", async () => {
    listLessons.mockClear();

    const response = await mcp({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "list_course_lessons",
        arguments: {
          courseId: "not-a-uuid",
        },
      },
    }, "Bearer test-token");

    expect(response.status).toBe(200);
    expect(listLessons).not.toHaveBeenCalled();

    expect(
      response.body.error ??
        response.body.result?.isError,
    ).toBeTruthy();
  });

  it("invokes list_academy_certificates with trusted claims", async () => {
    listCertificates.mockClear();

    const response = await mcp({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "list_academy_certificates",
        arguments: {},
      },
    }, "Bearer test-token");

    expect(response.status).toBe(200);
    expect(response.body.error).toBeUndefined();

    expect(
      listCertificates,
    ).toHaveBeenCalledExactlyOnceWith(
      claims,
    );

    const text =
      response.body.result?.content?.[0]?.text;

    expect(JSON.parse(text ?? "{}")).toMatchObject({
      data: [{
        organisationId: claims.organisationId,
        certificateNumber: "NAB-TEST-001",
      }],
    });
  });

  it("invokes get_academy_certificate with a validated certificate identifier", async () => {
    getCertificate.mockClear();

    const certificateId =
      "55555555-5555-4555-8555-555555555555";

    const response = await mcp({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "get_academy_certificate",
        arguments: {
          certificateId,
        },
      },
    }, "Bearer test-token");

    expect(response.status).toBe(200);
    expect(response.body.error).toBeUndefined();

    expect(
      getCertificate,
    ).toHaveBeenCalledExactlyOnceWith(
      certificateId,
      claims,
    );

    const text =
      response.body.result?.content?.[0]?.text;

    expect(JSON.parse(text ?? "{}")).toMatchObject({
      data: {
        id: certificateId,
        organisationId: claims.organisationId,
        certificateNumber: "NAB-TEST-001",
      },
    });
  });

  it("rejects invalid get_academy_certificate arguments before use-case execution", async () => {
    getCertificate.mockClear();

    const response = await mcp({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "get_academy_certificate",
        arguments: {
          certificateId: "not-a-uuid",
        },
      },
    }, "Bearer test-token");

    expect(response.status).toBe(200);
    expect(getCertificate).not.toHaveBeenCalled();

    expect(
      response.body.error ??
        response.body.result?.isError,
    ).toBeTruthy();
  });

  it("enrols in an Academy course using trusted claims", async () => {
    enrol.mockClear();

    const courseId =
      "33333333-3333-4333-8333-333333333333";

    const response = await mcp({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "enrol_in_academy_course",
        arguments: {
          courseId,
        },
      },
    }, "Bearer test-token");

    expect(response.status).toBe(200);
    expect(response.body.error).toBeUndefined();

    expect(enrol).toHaveBeenCalledExactlyOnceWith(
      courseId,
      claims,
    );

    const text =
      response.body.result?.content?.[0]?.text;

    expect(JSON.parse(text ?? "{}")).toMatchObject({
      data: {
        organisationId: claims.organisationId,
        learnerId: claims.subject,
        courseId,
        status: "ACTIVE",
      },
    });
  });

  it("rejects invalid enrolment arguments before use-case execution", async () => {
    enrol.mockClear();

    const response = await mcp({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: {
        name: "enrol_in_academy_course",
        arguments: {
          courseId: "not-a-uuid",
        },
      },
    }, "Bearer test-token");

    expect(response.status).toBe(200);
    expect(enrol).not.toHaveBeenCalled();

    expect(
      response.body.error ??
        response.body.result?.isError,
    ).toBeTruthy();
  });

  it("sanitises Academy enrolment use-case failures", async () => {
    enrol.mockClear();

    const courseId =
      "77777777-7777-4777-8777-777777777777";

    enrol.mockRejectedValueOnce(
      new Error(
        "sensitive persistence failure",
      ),
    );

    const response = await mcp({
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "enrol_in_academy_course",
        arguments: {
          courseId,
        },
      },
    }, "Bearer test-token");

    expect(response.status).toBe(200);

    expect(enrol).toHaveBeenCalledExactlyOnceWith(
      courseId,
      claims,
    );

    expect(response.body.error)
      .toBeUndefined();

    expect(response.body.result?.isError)
      .toBe(true);

    const text =
      response.body.result?.content?.[0]?.text;

    const parsed =
      JSON.parse(text ?? "{}");

    expect(parsed).toEqual({
      error: {
        code:
          "MCP_TOOL_EXECUTION_FAILED",
        message:
          "The requested Academy operation could not be completed.",
      },
    });

    expect(text).not.toContain(
      "sensitive persistence failure",
    );
  });

  it("rejects an unknown tool", async () => {
    const response = await mcp({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "unknown_tool",
        arguments: {},
      },
    }, "Bearer test-token");

    expect(response.status).toBe(200);

    expect(
      response.body.error ??
        response.body.result?.isError,
    ).toBeTruthy();
  });

  it("rejects malformed JSON-RPC requests", async () => {
    const response = await mcp({
      unsupported: true,
    });

    expect(
      response.status >= 400 ||
        response.body.error,
    ).toBeTruthy();
  });
});
