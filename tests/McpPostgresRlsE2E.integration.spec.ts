import {
  randomUUID,
} from "node:crypto";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import {
  generateKeyPair,
  SignJWT,
} from "jose";
import {
  Pool,
  type PoolClient,
  type QueryResultRow,
} from "pg";

import {
  createRuntime,
  type RuntimeProcess,
} from "../src/runtime.js";
import {
  JoseJwtVerifier,
} from "../src/infrastructure/authentication/JoseJwtVerifier.js";

interface TenantFixture {
  readonly organisationId: string;
  readonly learnerId: string;
  readonly courseId: string;
  readonly lessonId: string;
  readonly enrolmentId: string;
  readonly certificateId: string;
  readonly enrolmentCourseId: string;
}

interface Fixtures {
  readonly tenantA: TenantFixture;
  readonly tenantB: TenantFixture;
  readonly organisationIds: readonly string[];
  readonly userIds: readonly string[];
}

interface McpJsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id?: number;
  readonly result?: {
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

interface AcademyCourseResult {
  readonly id: string;
  readonly organisationId: string;
  readonly stableKey: string;
  readonly version: number;
  readonly title: string;
  readonly description: string;
  readonly isPublished: boolean;
}

interface AcademyLessonResult {
  readonly id: string;
  readonly organisationId: string;
  readonly courseId: string;
  readonly stableKey: string;
  readonly title: string;
  readonly content: Record<string, unknown>;
  readonly sequenceNumber: number;
  readonly estimatedDurationMinutes?: number;
  readonly isPublished: boolean;
}

interface AcademyCertificateResult {
  readonly id: string;
  readonly organisationId: string;
  readonly learnerId: string;
  readonly courseId: string;
  readonly enrolmentId: string;
  readonly certificateNumber: string;
  readonly issuedAt: string;
  readonly issuedById?: string;
  readonly metadata: Record<string, unknown>;
}

interface TextToolPayload<T> {
  readonly data: T;
}

interface DatabaseIdentityRow extends QueryResultRow {
  readonly session_user: string;
  readonly current_user: string;
  readonly current_database: string;
}

const databaseUrl =
  process.env.NABUUMA_TEST_DATABASE_URL;

const allowedDatabases = new Set([
  "nabuuma_test",
  "nabuuma_rls_test",
]);

const issuer =
  "https://identity.example.test";

const audience =
  "nabuuma-hospitality-mcp-postgres-test";

function validateDatabaseUrl(
  value: string,
): void {
  const url = new URL(value);
  const host =
    url.hostname.replace(/^\[|\]$/g, "");

  const database =
    decodeURIComponent(
      url.pathname.replace(/^\//, ""),
    );

  if (
    ![
      "postgres:",
      "postgresql:",
    ].includes(url.protocol)
  ) {
    throw new Error(
      "Test database URL must use PostgreSQL.",
    );
  }

  if (
    ![
      "localhost",
      "127.0.0.1",
      "::1",
    ].includes(host)
  ) {
    throw new Error(
      "Integration tests may connect only to localhost.",
    );
  }

  if (url.port !== "55433") {
    throw new Error(
      "Integration tests require PostgreSQL port 55433.",
    );
  }

  if (!allowedDatabases.has(database)) {
    throw new Error(
      "Database is not on the integration-test allowlist.",
    );
  }
}

function createAdminPool(): Pool {
  const port =
    Number(process.env.PGPORT ?? 55432);

  if (
    !Number.isInteger(port) ||
    port !== 55433
  ) {
    throw new Error(
      "Administrative fixture pool requires PostgreSQL port 55433.",
    );
  }

  const host =
    process.env.PGHOST ?? "127.0.0.1";

  if (
    ![
      "localhost",
      "127.0.0.1",
      "::1",
    ].includes(host)
  ) {
    throw new Error(
      "Administrative fixture pool may connect only to localhost.",
    );
  }

  const database =
    process.env.PGDATABASE ??
    "nabuuma_rls_test";

  if (!allowedDatabases.has(database)) {
    throw new Error(
      "Administrative fixture database is not allowlisted.",
    );
  }

  const user =
    process.env.PGUSER;

  if (!user) {
    throw new Error(
      "Administrative fixture user is missing.",
    );
  }

  return new Pool({
    host,
    port,
    database,
    user,
    password:
      process.env.PGPASSWORD,
    max: 1,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 1000,
  });
}

async function seedFixtures(
  pool: Pool,
): Promise<Fixtures> {
  const tenantA: TenantFixture = {
    organisationId: randomUUID(),
    learnerId: randomUUID(),
    courseId: randomUUID(),
    lessonId: randomUUID(),
    enrolmentId: randomUUID(),
    certificateId: randomUUID(),
    enrolmentCourseId: randomUUID(),
  };

  const tenantB: TenantFixture = {
    organisationId: randomUUID(),
    learnerId: randomUUID(),
    courseId: randomUUID(),
    lessonId: randomUUID(),
    enrolmentId: randomUUID(),
    certificateId: randomUUID(),
    enrolmentCourseId: randomUUID(),
  };

  const client =
    await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `
        INSERT INTO nabuuma.organisations (
          id,
          name,
          code,
          level
        )
        VALUES
          (
            $1,
            'MCP E2E Tenant A',
            $2,
            'TEAM'
          ),
          (
            $3,
            'MCP E2E Tenant B',
            $4,
            'TEAM'
          )
      `,
      [
        tenantA.organisationId,
        `MCP-A-${tenantA.organisationId.slice(0, 8)}`,
        tenantB.organisationId,
        `MCP-B-${tenantB.organisationId.slice(0, 8)}`,
      ],
    );

    await client.query(
      `
        INSERT INTO nabuuma.users (
          id,
          display_name,
          email
        )
        VALUES
          (
            $1,
            'MCP E2E Learner A',
            $2
          ),
          (
            $3,
            'MCP E2E Learner B',
            $4
          )
      `,
      [
        tenantA.learnerId,
        `mcp-a-${tenantA.learnerId}@example.test`,
        tenantB.learnerId,
        `mcp-b-${tenantB.learnerId}@example.test`,
      ],
    );

    await client.query(
      `
        INSERT INTO nabuuma.organisation_memberships (
          organisation_id,
          user_id,
          role,
          is_active
        )
        VALUES
          ($1, $2, 'LEARNER', true),
          ($3, $4, 'LEARNER', true)
      `,
      [
        tenantA.organisationId,
        tenantA.learnerId,
        tenantB.organisationId,
        tenantB.learnerId,
      ],
    );

    await client.query(
      `
        INSERT INTO nabuuma.academy_courses (
          id,
          organisation_id,
          stable_key,
          version,
          title,
          description,
          is_published,
          created_by_id
        )
        VALUES
          (
            $1,
            $2,
            $3,
            1,
            'MCP E2E Course A',
            'Tenant A MCP PostgreSQL fixture',
            true,
            $4
          ),
          (
            $5,
            $6,
            $7,
            1,
            'MCP E2E Course B',
            'Tenant B MCP PostgreSQL fixture',
            true,
            $8
          )
      `,
      [
        tenantA.courseId,
        tenantA.organisationId,
        `mcp.course.a.${tenantA.courseId}`,
        tenantA.learnerId,
        tenantB.courseId,
        tenantB.organisationId,
        `mcp.course.b.${tenantB.courseId}`,
        tenantB.learnerId,
      ],
    );

    await client.query(
      `
        INSERT INTO nabuuma.academy_courses (
          id,
          organisation_id,
          stable_key,
          version,
          title,
          description,
          is_published,
          created_by_id
        )
        VALUES
          (
            $1,
            $2,
            $3,
            1,
            'MCP E2E Enrolment Course A',
            'Tenant A MCP enrolment fixture',
            true,
            $4
          ),
          (
            $5,
            $6,
            $7,
            1,
            'MCP E2E Enrolment Course B',
            'Tenant B MCP enrolment fixture',
            true,
            $8
          )
      `,
      [
        tenantA.enrolmentCourseId,
        tenantA.organisationId,
        `mcp.enrolment.a.${tenantA.enrolmentCourseId}`,
        tenantA.learnerId,
        tenantB.enrolmentCourseId,
        tenantB.organisationId,
        `mcp.enrolment.b.${tenantB.enrolmentCourseId}`,
        tenantB.learnerId,
      ],
    );

    await client.query(
      `
        INSERT INTO nabuuma.academy_lessons (
          id,
          organisation_id,
          course_id,
          stable_key,
          title,
          content,
          sequence_number,
          is_published
        )
        VALUES
          (
            $1,
            $2,
            $3,
            $4,
            'MCP E2E Lesson A',
            '{}'::jsonb,
            1,
            true
          ),
          (
            $5,
            $6,
            $7,
            $8,
            'MCP E2E Lesson B',
            '{}'::jsonb,
            1,
            true
          )
      `,
      [
        tenantA.lessonId,
        tenantA.organisationId,
        tenantA.courseId,
        `mcp.lesson.a.${tenantA.lessonId}`,
        tenantB.lessonId,
        tenantB.organisationId,
        tenantB.courseId,
        `mcp.lesson.b.${tenantB.lessonId}`,
      ],
    );

    await client.query(
      `
        INSERT INTO nabuuma.academy_enrolments (
          id,
          organisation_id,
          learner_id,
          course_id,
          status,
          completed_at
        )
        VALUES
          ($1, $2, $3, $4, 'COMPLETED', now()),
          ($5, $6, $7, $8, 'COMPLETED', now())
      `,
      [
        tenantA.enrolmentId,
        tenantA.organisationId,
        tenantA.learnerId,
        tenantA.courseId,
        tenantB.enrolmentId,
        tenantB.organisationId,
        tenantB.learnerId,
        tenantB.courseId,
      ],
    );

    await client.query(
      `
        INSERT INTO nabuuma.academy_certificates (
          id,
          organisation_id,
          learner_id,
          course_id,
          enrolment_id,
          certificate_number,
          issued_by_id,
          metadata
        )
        VALUES
          (
            $1, $2, $3, $4, $5, $6, $3,
            '{"source":"mcp-e2e"}'::jsonb
          ),
          (
            $7, $8, $9, $10, $11, $12, $9,
            '{"source":"mcp-e2e"}'::jsonb
          )
      `,
      [
        tenantA.certificateId,
        tenantA.organisationId,
        tenantA.learnerId,
        tenantA.courseId,
        tenantA.enrolmentId,
        `NAB-MCP-A-${tenantA.certificateId}`,
        tenantB.certificateId,
        tenantB.organisationId,
        tenantB.learnerId,
        tenantB.courseId,
        tenantB.enrolmentId,
        `NAB-MCP-B-${tenantB.certificateId}`,
      ],
    );

    await client.query("COMMIT");

    return {
      tenantA,
      tenantB,
      organisationIds: [
        tenantA.organisationId,
        tenantB.organisationId,
      ],
      userIds: [
        tenantA.learnerId,
        tenantB.learnerId,
      ],
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function cleanupFixtures(
  pool: Pool,
  fixtures: Fixtures,
): Promise<void> {
  const client =
    await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `
        DELETE FROM nabuuma.academy_lesson_progress
        WHERE organisation_id = ANY($1::uuid[])
      `,
      [fixtures.organisationIds],
    );

    await client.query(
      `
        DELETE FROM nabuuma.academy_certificates
        WHERE organisation_id = ANY($1::uuid[])
      `,
      [fixtures.organisationIds],
    );

    await client.query(
      `
        DELETE FROM nabuuma.academy_enrolments
        WHERE organisation_id = ANY($1::uuid[])
      `,
      [fixtures.organisationIds],
    );

    await client.query(
      `
        DELETE FROM nabuuma.academy_lessons
        WHERE organisation_id = ANY($1::uuid[])
      `,
      [fixtures.organisationIds],
    );

    await client.query(
      `
        DELETE FROM nabuuma.academy_courses
        WHERE organisation_id = ANY($1::uuid[])
      `,
      [fixtures.organisationIds],
    );

    await client.query(
      `
        DELETE FROM nabuuma.organisation_memberships
        WHERE organisation_id = ANY($1::uuid[])
      `,
      [fixtures.organisationIds],
    );

    // Audit events are immutable and retain RESTRICT foreign keys to their
    // organisation and actor. Preserve those identities while removing all
    // mutable Academy fixture state.
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function decodeJsonRpcResponse(
  text: string,
): McpJsonRpcResponse {
  const trimmed =
    text.trim();

  if (trimmed.startsWith("{")) {
    return JSON.parse(
      trimmed,
    ) as McpJsonRpcResponse;
  }

  const dataLines =
    trimmed
      .split(/\r?\n/)
      .filter((line) =>
        line.startsWith("data:"),
      )
      .map((line) =>
        line.slice("data:".length).trim(),
      );

  if (dataLines.length !== 1) {
    throw new Error(
      `Expected one MCP data event; received ${dataLines.length}.`,
    );
  }

  const payload =
    dataLines[0];

  if (!payload) {
    throw new Error(
      "MCP data event was empty.",
    );
  }

  return JSON.parse(
    payload,
  ) as McpJsonRpcResponse;
}

function decodeToolData<T>(
  response: McpJsonRpcResponse,
): T {
  if (response.error) {
    throw new Error(
      `MCP JSON-RPC error ${response.error.code}: ${response.error.message}`,
    );
  }

  if (!response.result) {
    throw new Error(
      "MCP response did not contain a result.",
    );
  }

  if (response.result.isError) {
    throw new Error(
      "MCP tool returned an error result.",
    );
  }

  const content =
    response.result.content;

  if (
    !content ||
    content.length !== 1
  ) {
    throw new Error(
      "MCP result must contain exactly one content item.",
    );
  }

  const item =
    content[0];

  if (
    !item ||
    item.type !== "text" ||
    typeof item.text !== "string"
  ) {
    throw new Error(
      "MCP result content must be one text item.",
    );
  }

  const payload =
    JSON.parse(item.text) as
      Partial<TextToolPayload<T>>;

  if (!("data" in payload)) {
    throw new Error(
      "MCP text payload did not contain data.",
    );
  }

  return payload.data as T;
}

const suite = describe.skipIf(!databaseUrl)(
  "JWT to MCP to PostgreSQL RLS integration",
  () => {
    let adminPool: Pool | undefined;
    let runtimePool: Pool | undefined;
    let runtime: RuntimeProcess | undefined;
    let fixtures: Fixtures | undefined;
    let origin = "";

    let privateKey: Awaited<
      ReturnType<typeof generateKeyPair>
    >["privateKey"];

    let publicKey: Awaited<
      ReturnType<typeof generateKeyPair>
    >["publicKey"];

    beforeAll(async () => {
      if (!databaseUrl) {
        throw new Error(
          "NABUUMA_TEST_DATABASE_URL is missing.",
        );
      }

      validateDatabaseUrl(databaseUrl);

      adminPool =
        createAdminPool();

      fixtures =
        await seedFixtures(adminPool);

      const keys =
        await generateKeyPair("RS256");

      privateKey =
        keys.privateKey;

      publicKey =
        keys.publicKey;

      runtimePool = new Pool({
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
            if (!runtimePool) {
              throw new Error(
                "Runtime pool was not initialised.",
              );
            }

            return runtimePool;
          },
          closePool: async () => {
            await runtimePool?.end();
          },
          createVerifier: (config) =>
            new JoseJwtVerifier(
              config,
              async () => publicKey,
            ),
        },
      );

      await runtime.app.listen({
        host: "127.0.0.1",
        port: 0,
      });

      const address =
        runtime.app.server.address();

      if (
        !address ||
        typeof address === "string"
      ) {
        throw new Error(
          "MCP E2E runtime did not expose a TCP address.",
        );
      }

      origin =
        `http://127.0.0.1:${address.port}`;

      runtime.lifecycle.markReady();
    }, 20000);

    afterAll(async () => {
      const failures: unknown[] = [];

      if (runtime) {
        try {
          await runtime.lifecycle.shutdown();
        } catch (error) {
          failures.push(error);
        }
      } else if (runtimePool) {
        try {
          await runtimePool.end();
        } catch (error) {
          failures.push(error);
        }
      }

      if (
        adminPool &&
        fixtures
      ) {
        try {
          await cleanupFixtures(
            adminPool,
            fixtures,
          );
        } catch (error) {
          failures.push(error);
        }
      }

      if (adminPool) {
        try {
          await adminPool.end();
        } catch (error) {
          failures.push(error);
        }
      }

      if (failures.length === 1) {
        throw failures[0];
      }

      if (failures.length > 1) {
        throw new AggregateError(
          failures,
          "MCP PostgreSQL E2E cleanup failed.",
        );
      }
    }, 20000);

    async function token(
      tenant: TenantFixture,
    ): Promise<string> {
      const now =
        Math.floor(Date.now() / 1000);

      return new SignJWT({
        organisation_id:
          tenant.organisationId,
        roles: ["LEARNER"],
      })
        .setProtectedHeader({
          alg: "RS256",
        })
        .setIssuer(issuer)
        .setAudience(audience)
        .setSubject(
          tenant.learnerId,
        )
        .setIssuedAt(now)
        .setExpirationTime(
          now + 120,
        )
        .sign(privateKey);
    }

    async function callTool<T>(
      accessToken: string,
      name: string,
      argumentsValue: Readonly<
        Record<string, unknown>
      > = {},
    ): Promise<T> {
      const response =
        await fetch(
          `${origin}/mcp`,
          {
            method: "POST",
            headers: {
              accept:
                "application/json, text/event-stream",
              authorization:
                `Bearer ${accessToken}`,
              "content-type":
                "application/json",
              origin,
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "tools/call",
              params: {
                name,
                arguments:
                  argumentsValue,
              },
            }),
          },
        );

      const responseText =
        await response.text();

      if (response.status !== 200) {
        throw new Error(
          `MCP HTTP ${response.status}: ${responseText}`,
        );
      }

      return decodeToolData<T>(
        decodeJsonRpcResponse(
          responseText,
        ),
      );
    }

    function requireFixtures(): Fixtures {
      if (!fixtures) {
        throw new Error(
          "MCP E2E fixtures are unavailable.",
        );
      }

      return fixtures;
    }

    it(
      "returns only Tenant A published courses for a Tenant A JWT",
      async () => {
        const value =
          requireFixtures();

        const courses =
          await callTool<
            readonly AcademyCourseResult[]
          >(
            await token(
              value.tenantA,
            ),
            "list_published_courses",
          );

        expect(courses.length)
          .toBeGreaterThan(0);

        expect(
          courses.some(
            ({ id }) =>
              id ===
              value.tenantA.courseId,
          ),
        ).toBe(true);

        expect(
          courses.some(
            ({ id }) =>
              id ===
              value.tenantB.courseId,
          ),
        ).toBe(false);

        expect(
          courses.every(
            ({ organisationId }) =>
              organisationId ===
              value.tenantA.organisationId,
          ),
        ).toBe(true);
      },
    );

    it(
      "returns only Tenant B published courses for a Tenant B JWT",
      async () => {
        const value =
          requireFixtures();

        const courses =
          await callTool<
            readonly AcademyCourseResult[]
          >(
            await token(
              value.tenantB,
            ),
            "list_published_courses",
          );

        expect(courses.length)
          .toBeGreaterThan(0);

        expect(
          courses.some(
            ({ id }) =>
              id ===
              value.tenantB.courseId,
          ),
        ).toBe(true);

        expect(
          courses.some(
            ({ id }) =>
              id ===
              value.tenantA.courseId,
          ),
        ).toBe(false);

        expect(
          courses.every(
            ({ organisationId }) =>
              organisationId ===
              value.tenantB.organisationId,
          ),
        ).toBe(true);
      },
    );

    it(
      "returns no Tenant A lessons when Tenant B requests Tenant A course",
      async () => {
        const value =
          requireFixtures();

        const lessons =
          await callTool<
            readonly AcademyLessonResult[]
          >(
            await token(
              value.tenantB,
            ),
            "list_course_lessons",
            {
              courseId:
                value.tenantA.courseId,
            },
          );

        expect(lessons).toEqual([]);
      },
    );

    it(
      "keeps concurrent Tenant A and Tenant B MCP calls isolated",
      async () => {
        const value =
          requireFixtures();

        const [
          tokenA,
          tokenB,
        ] = await Promise.all([
          token(value.tenantA),
          token(value.tenantB),
        ]);

        const [
          coursesA,
          coursesB,
        ] = await Promise.all([
          callTool<
            readonly AcademyCourseResult[]
          >(
            tokenA,
            "list_published_courses",
          ),
          callTool<
            readonly AcademyCourseResult[]
          >(
            tokenB,
            "list_published_courses",
          ),
        ]);

        expect(coursesA.length)
          .toBeGreaterThan(0);

        expect(coursesB.length)
          .toBeGreaterThan(0);

        expect(
          coursesA.some(
            ({ id }) =>
              id ===
              value.tenantA.courseId,
          ),
        ).toBe(true);

        expect(
          coursesA.some(
            ({ id }) =>
              id ===
              value.tenantB.courseId,
          ),
        ).toBe(false);

        expect(
          coursesA.every(
            ({ organisationId }) =>
              organisationId ===
              value.tenantA.organisationId,
          ),
        ).toBe(true);

        expect(
          coursesB.some(
            ({ id }) =>
              id ===
              value.tenantB.courseId,
          ),
        ).toBe(true);

        expect(
          coursesB.some(
            ({ id }) =>
              id ===
              value.tenantA.courseId,
          ),
        ).toBe(false);

        expect(
          coursesB.every(
            ({ organisationId }) =>
              organisationId ===
              value.tenantB.organisationId,
          ),
        ).toBe(true);
      },
    );

    it(
      "returns only the authenticated learner's certificates for each tenant",
      async () => {
        const value =
          requireFixtures();

        const [
          tokenA,
          tokenB,
        ] = await Promise.all([
          token(value.tenantA),
          token(value.tenantB),
        ]);

        const [
          certificatesA,
          certificatesB,
        ] = await Promise.all([
          callTool<
            readonly AcademyCertificateResult[]
          >(
            tokenA,
            "list_academy_certificates",
          ),
          callTool<
            readonly AcademyCertificateResult[]
          >(
            tokenB,
            "list_academy_certificates",
          ),
        ]);

        expect(certificatesA).toHaveLength(1);
        expect(certificatesB).toHaveLength(1);

        expect(certificatesA[0]).toMatchObject({
          id:
            value.tenantA.certificateId,
          organisationId:
            value.tenantA.organisationId,
          learnerId:
            value.tenantA.learnerId,
          courseId:
            value.tenantA.courseId,
          enrolmentId:
            value.tenantA.enrolmentId,
          certificateNumber:
            `NAB-MCP-A-${value.tenantA.certificateId}`,
          metadata: {
            source: "mcp-e2e",
          },
        });

        expect(certificatesB[0]).toMatchObject({
          id:
            value.tenantB.certificateId,
          organisationId:
            value.tenantB.organisationId,
          learnerId:
            value.tenantB.learnerId,
          courseId:
            value.tenantB.courseId,
          enrolmentId:
            value.tenantB.enrolmentId,
          certificateNumber:
            `NAB-MCP-B-${value.tenantB.certificateId}`,
          metadata: {
            source: "mcp-e2e",
          },
        });

        expect(
          certificatesA.some(
            ({ id }) =>
              id === value.tenantB.certificateId,
          ),
        ).toBe(false);

        expect(
          certificatesB.some(
            ({ id }) =>
              id === value.tenantA.certificateId,
          ),
        ).toBe(false);
      },
    );

    it(
      "returns a same-tenant certificate by identifier",
      async () => {
        const value =
          requireFixtures();

        const certificate =
          await callTool<
            AcademyCertificateResult
          >(
            await token(value.tenantA),
            "get_academy_certificate",
            {
              certificateId:
                value.tenantA.certificateId,
            },
          );

        expect(certificate).toMatchObject({
          id:
            value.tenantA.certificateId,
          organisationId:
            value.tenantA.organisationId,
          learnerId:
            value.tenantA.learnerId,
          courseId:
            value.tenantA.courseId,
          enrolmentId:
            value.tenantA.enrolmentId,
          certificateNumber:
            `NAB-MCP-A-${value.tenantA.certificateId}`,
          metadata: {
            source: "mcp-e2e",
          },
        });

        expect(certificate.issuedAt)
          .toEqual(expect.any(String));
      },
    );

    it(
      "does not disclose a Tenant A certificate to a Tenant B JWT",
      async () => {
        const value =
          requireFixtures();

        const accessToken =
          await token(value.tenantB);

        const response =
          await fetch(
            `${origin}/mcp`,
            {
              method: "POST",
              headers: {
                accept:
                  "application/json, text/event-stream",
                authorization:
                  `Bearer ${accessToken}`,
                "content-type":
                  "application/json",
                origin,
              },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 2,
                method: "tools/call",
                params: {
                  name:
                    "get_academy_certificate",
                  arguments: {
                    certificateId:
                      value.tenantA.certificateId,
                  },
                },
              }),
            },
          );

        const responseText =
          await response.text();

        expect(response.status).toBe(200);

        const payload =
          decodeJsonRpcResponse(
            responseText,
          );

        expect(payload.error)
          .toBeUndefined();

        expect(payload.result?.isError)
          .toBe(true);

        const content =
          payload.result?.content;

        expect(content).toHaveLength(1);
        expect(content?.[0]?.type).toBe("text");

        const text =
          content?.[0]?.text;

        expect(
          JSON.parse(text ?? "{}"),
        ).toEqual({
          error: {
            code:
              "MCP_TOOL_EXECUTION_FAILED",
            message:
              "The requested Academy operation could not be completed.",
          },
        });
      },
    );

    it(
      "enrols the authenticated learner in a same-tenant course",
      async () => {
        const value =
          requireFixtures();

        const enrolment =
          await callTool<{
            readonly id: string;
            readonly organisationId: string;
            readonly learnerId: string;
            readonly courseId: string;
            readonly status: string;
            readonly enrolledAt: string;
          }>(
            await token(value.tenantA),
            "enrol_in_academy_course",
            {
              courseId:
                value.tenantA.enrolmentCourseId,
            },
          );

        expect(enrolment).toMatchObject({
          organisationId:
            value.tenantA.organisationId,
          learnerId:
            value.tenantA.learnerId,
          courseId:
            value.tenantA.enrolmentCourseId,
          status: "ACTIVE",
        });

        expect(enrolment.id)
          .toEqual(expect.any(String));

        expect(enrolment.enrolledAt)
          .toEqual(expect.any(String));
      },
    );

    it(
      "returns the same enrolment for repeated MCP enrolment",
      async () => {
        const value =
          requireFixtures();

        const accessToken =
          await token(value.tenantA);

        const first =
          await callTool<{
            readonly id: string;
            readonly courseId: string;
          }>(
            accessToken,
            "enrol_in_academy_course",
            {
              courseId:
                value.tenantA.enrolmentCourseId,
            },
          );

        const second =
          await callTool<{
            readonly id: string;
            readonly courseId: string;
          }>(
            accessToken,
            "enrol_in_academy_course",
            {
              courseId:
                value.tenantA.enrolmentCourseId,
            },
          );

        expect(second.id).toBe(first.id);

        expect(second.courseId).toBe(
          value.tenantA.enrolmentCourseId,
        );
      },
    );

    it(
      "does not enrol Tenant B into a Tenant A course",
      async () => {
        const value =
          requireFixtures();

        const accessToken =
          await token(value.tenantB);

        const response =
          await fetch(
            `${origin}/mcp`,
            {
              method: "POST",
              headers: {
                accept:
                  "application/json, text/event-stream",
                authorization:
                  `Bearer ${accessToken}`,
                "content-type":
                  "application/json",
                origin,
              },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 3,
                method: "tools/call",
                params: {
                  name:
                    "enrol_in_academy_course",
                  arguments: {
                    courseId:
                      value.tenantA.enrolmentCourseId,
                  },
                },
              }),
            },
          );

        const responseText =
          await response.text();

        expect(response.status).toBe(200);

        const payload =
          decodeJsonRpcResponse(
            responseText,
          );

        expect(payload.error)
          .toBeUndefined();

        expect(payload.result?.isError)
          .toBe(true);

        const content =
          payload.result?.content;

        expect(content).toHaveLength(1);
        expect(content?.[0]?.type).toBe("text");

        const text =
          content?.[0]?.text;

        expect(
          JSON.parse(text ?? "{}"),
        ).toEqual({
          error: {
            code:
              "MCP_TOOL_EXECUTION_FAILED",
            message:
              "The requested Academy operation could not be completed.",
          },
        });

        expect(text).not.toContain(
          value.tenantA.enrolmentCourseId,
        );
      },
    );

    it(
      "uses the restricted nabuuma_runtime database identity",
      async () => {
        if (!runtimePool) {
          throw new Error(
            "Runtime pool is unavailable.",
          );
        }

        const result =
          await runtimePool.query<
            DatabaseIdentityRow
          >(
            `
              SELECT
                session_user,
                current_user,
                current_database()
            `,
          );

        expect(result.rows[0])
          .toEqual({
            session_user:
              "nabuuma_runtime",
            current_user:
              "nabuuma_runtime",
            current_database:
              "nabuuma_rls_test",
          });
      },
    );
  },
);

void suite;
