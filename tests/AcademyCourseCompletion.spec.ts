import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import {
  Pool,
  type PoolClient,
  type QueryResultRow,
} from "pg";

interface CompletionFixture {
  readonly organisationId: string;
  readonly learnerId: string;
  readonly courseId: string;
  readonly lessonId: string;
  readonly enrolmentId: string;
}

interface CompletionFixtures {
  readonly successful: CompletionFixture;
  readonly incomplete: CompletionFixture;
  readonly retry: CompletionFixture;
  readonly foreign: CompletionFixture;
  readonly organisationIds: readonly string[];
  readonly userIds: readonly string[];
}

interface CertificateRow extends QueryResultRow {
  readonly id: string;
  readonly organisation_id: string;
  readonly learner_id: string;
  readonly course_id: string;
  readonly enrolment_id: string;
  readonly certificate_number: string;
  readonly issued_at: Date | string;
  readonly issued_by_id: string | null;
  readonly metadata: Record<string, unknown>;
}

interface CertificateCountRow extends QueryResultRow {
  readonly certificate_count: string;
}

interface EnrolmentRow extends QueryResultRow {
  readonly status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  readonly completed_at: Date | string | null;
}

interface PostgreSqlError extends Error {
  readonly code?: string;
  readonly detail?: string;
}

const runRlsIntegration =
  process.env.RUN_RLS_INTEGRATION === "1";

const pool = new Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 55432),
  database: process.env.PGDATABASE ?? "nabuuma_test",
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
});

function createFixture(): CompletionFixture {
  return {
    organisationId: randomUUID(),
    learnerId: randomUUID(),
    courseId: randomUUID(),
    lessonId: randomUUID(),
    enrolmentId: randomUUID(),
  };
}

async function beginApplicationTransaction(
  client: PoolClient,
  fixture: CompletionFixture,
): Promise<void> {
  await client.query("BEGIN");
  await client.query("SET ROLE nabuuma_app");

  await client.query(
    `
      SELECT
        set_config('app.user_id', $1, true),
        set_config('app.organisation_id', $2, true)
    `,
    [
      fixture.learnerId,
      fixture.organisationId,
    ],
  );
}

async function rollbackApplicationTransaction(
  client: PoolClient,
): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } finally {
    await client.query("RESET ROLE");
  }
}

async function seedFixture(
  client: PoolClient,
  fixture: CompletionFixture,
  label: string,
  completed: boolean,
): Promise<void> {
  await client.query(
    `
      INSERT INTO nabuuma.organisations (
        id,
        name,
        code,
        level
      )
      VALUES ($1, $2, $3, 'TEAM')
    `,
    [
      fixture.organisationId,
      `Completion Tenant ${label}`,
      `CMP-${fixture.organisationId.slice(0, 8)}`,
    ],
  );

  await client.query(
    `
      INSERT INTO nabuuma.users (
        id,
        display_name,
        email
      )
      VALUES ($1, $2, $3)
    `,
    [
      fixture.learnerId,
      `Completion Learner ${label}`,
      `completion-${fixture.learnerId}@example.test`,
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
      VALUES ($1, $2, 'LEARNER', true)
    `,
    [
      fixture.organisationId,
      fixture.learnerId,
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
      VALUES (
        $1,
        $2,
        $3,
        1,
        $4,
        'Course-completion integration fixture',
        true,
        $5
      )
    `,
    [
      fixture.courseId,
      fixture.organisationId,
      `completion.${label}.${fixture.courseId}`,
      `Completion Course ${label}`,
      fixture.learnerId,
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
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        '{}'::jsonb,
        1,
        true
      )
    `,
    [
      fixture.lessonId,
      fixture.organisationId,
      fixture.courseId,
      `completion.lesson.${label}.${fixture.lessonId}`,
      `Completion Lesson ${label}`,
    ],
  );

  await client.query(
    `
      INSERT INTO nabuuma.academy_enrolments (
        id,
        organisation_id,
        learner_id,
        course_id,
        status
      )
      VALUES ($1, $2, $3, $4, 'ACTIVE')
    `,
    [
      fixture.enrolmentId,
      fixture.organisationId,
      fixture.learnerId,
      fixture.courseId,
    ],
  );

  await client.query(
    `
      INSERT INTO nabuuma.academy_lesson_progress (
        organisation_id,
        learner_id,
        course_id,
        enrolment_id,
        lesson_id,
        status,
        progress_percent,
        started_at,
        completed_at,
        last_activity_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        now(),
        CASE WHEN $6 = 'COMPLETED' THEN now() ELSE NULL END,
        now()
      )
    `,
    [
      fixture.organisationId,
      fixture.learnerId,
      fixture.courseId,
      fixture.enrolmentId,
      fixture.lessonId,
      completed ? "COMPLETED" : "IN_PROGRESS",
      completed ? 100 : 50,
    ],
  );
}

async function seedFixtures(): Promise<CompletionFixtures> {
  const successful = createFixture();
  const incomplete = createFixture();
  const retry = createFixture();
  const foreign = createFixture();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await seedFixture(client, successful, "Successful", true);
    await seedFixture(client, incomplete, "Incomplete", false);
    await seedFixture(client, retry, "Retry", true);
    await seedFixture(client, foreign, "Foreign", true);

    await client.query("COMMIT");

    return {
      successful,
      incomplete,
      retry,
      foreign,
      organisationIds: [
        successful.organisationId,
        incomplete.organisationId,
        retry.organisationId,
        foreign.organisationId,
      ],
      userIds: [
        successful.learnerId,
        incomplete.learnerId,
        retry.learnerId,
        foreign.learnerId,
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
  fixtures: CompletionFixtures,
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (const table of [
      "academy_certificates",
      "academy_lesson_progress",
      "academy_enrolments",
      "academy_lessons",
      "academy_courses",
    ] as const) {
      await client.query(
        `
          DELETE FROM nabuuma.${table}
          WHERE organisation_id = ANY($1::uuid[])
        `,
        [fixtures.organisationIds],
      );
    }

    await client.query(
      `
        DELETE FROM nabuuma.organisations
        WHERE id = ANY($1::uuid[])
      `,
      [fixtures.organisationIds],
    );

    await client.query(
      `
        DELETE FROM nabuuma.users
        WHERE id = ANY($1::uuid[])
      `,
      [fixtures.userIds],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function completeCourse(
  client: PoolClient,
  fixture: CompletionFixture,
): Promise<CertificateRow> {
  const result = await client.query<CertificateRow>(
    `
      SELECT
        id,
        organisation_id,
        learner_id,
        course_id,
        enrolment_id,
        certificate_number,
        issued_at,
        issued_by_id,
        metadata
      FROM nabuuma.complete_academy_course($1, $2)
    `,
    [
      fixture.courseId,
      fixture.enrolmentId,
    ],
  );

  const certificate = result.rows[0];

  if (!certificate) {
    throw new Error(
      "Course completion returned no certificate.",
    );
  }

  return certificate;
}

async function captureDatabaseError(
  action: () => Promise<unknown>,
): Promise<PostgreSqlError> {
  try {
    await action();
  } catch (error) {
    if (error instanceof Error) {
      return error as PostgreSqlError;
    }

    throw new Error(
      "PostgreSQL returned a non-Error rejection.",
    );
  }

  throw new Error(
    "Expected PostgreSQL to reject course completion.",
  );
}

let fixtures: CompletionFixtures;

beforeAll(async () => {
  if (runRlsIntegration) {
    fixtures = await seedFixtures();
  }
});

afterAll(async () => {
  try {
    if (runRlsIntegration && fixtures) {
      await cleanupFixtures(fixtures);
    }
  } finally {
    await pool.end();
  }
});

describe.skipIf(!runRlsIntegration)(
  "Academy course completion",
  () => {
    it("issues a certificate for completed curriculum", async () => {
      const fixture = fixtures.successful;
      const client = await pool.connect();

      try {
        await beginApplicationTransaction(client, fixture);

        const certificate =
          await completeCourse(client, fixture);

        const enrolment =
          await client.query<EnrolmentRow>(
            `
              SELECT status, completed_at
              FROM nabuuma.academy_enrolments
              WHERE id = $1
            `,
            [fixture.enrolmentId],
          );

        const certificateCount =
          await client.query<CertificateCountRow>(
            `
              SELECT count(*)::text AS certificate_count
              FROM nabuuma.academy_certificates
              WHERE organisation_id = $1
                AND learner_id = $2
                AND course_id = $3
            `,
            [
              fixture.organisationId,
              fixture.learnerId,
              fixture.courseId,
            ],
          );

        expect(certificate).toMatchObject({
          organisation_id: fixture.organisationId,
          learner_id: fixture.learnerId,
          course_id: fixture.courseId,
          enrolment_id: fixture.enrolmentId,
          issued_by_id: null,
          metadata: {
            completion_source:
              "academy_course_completion",
          },
        });

        expect(certificate.certificate_number).toMatch(
          /^NAB-[a-f0-9]{32}$/,
        );

        expect(enrolment.rows[0]?.status).toBe(
          "COMPLETED",
        );

        expect(
          enrolment.rows[0]?.completed_at,
        ).not.toBeNull();

        expect(
          certificateCount.rows[0]?.certificate_count,
        ).toBe("1");
      } finally {
        await rollbackApplicationTransaction(client);
        client.release();
      }
    });

    it("rejects incomplete curriculum without issuing a certificate", async () => {
      const fixture = fixtures.incomplete;
      const client = await pool.connect();

      try {
        await beginApplicationTransaction(client, fixture);
        await client.query("SAVEPOINT completion_attempt");

        const rejection = await captureDatabaseError(
          async () => completeCourse(client, fixture),
        );

        await client.query(
          "ROLLBACK TO SAVEPOINT completion_attempt",
        );

        const certificateCount =
          await client.query<CertificateCountRow>(
            `
              SELECT count(*)::text AS certificate_count
              FROM nabuuma.academy_certificates
              WHERE organisation_id = $1
                AND learner_id = $2
                AND course_id = $3
            `,
            [
              fixture.organisationId,
              fixture.learnerId,
              fixture.courseId,
            ],
          );

        const enrolment =
          await client.query<EnrolmentRow>(
            `
              SELECT status, completed_at
              FROM nabuuma.academy_enrolments
              WHERE id = $1
            `,
            [fixture.enrolmentId],
          );

        expect(rejection.code).toBe("P0001");
        expect(rejection.message).toBe(
          "All published Academy lessons must be completed",
        );

        expect(
          certificateCount.rows[0]?.certificate_count,
        ).toBe("0");

        expect(enrolment.rows[0]).toEqual({
          status: "ACTIVE",
          completed_at: null,
        });
      } finally {
        await rollbackApplicationTransaction(client);
        client.release();
      }
    });

    it("rejects cross-tenant completion and exposes no foreign certificate", async () => {
      const caller = fixtures.successful;
      const foreign = fixtures.foreign;
      const client = await pool.connect();

      try {
        await beginApplicationTransaction(client, caller);
        await client.query("SAVEPOINT completion_attempt");

        const rejection = await captureDatabaseError(
          async () => completeCourse(client, foreign),
        );

        await client.query(
          "ROLLBACK TO SAVEPOINT completion_attempt",
        );

        const visibleForeignCertificates =
          await client.query<CertificateCountRow>(
            `
              SELECT count(*)::text AS certificate_count
              FROM nabuuma.academy_certificates
              WHERE organisation_id = $1
                 OR learner_id = $2
                 OR course_id = $3
            `,
            [
              foreign.organisationId,
              foreign.learnerId,
              foreign.courseId,
            ],
          );

        expect(rejection.code).toBe("P0001");
        expect(rejection.message).toBe(
          "Academy enrolment is unavailable for completion",
        );

        expect(
          visibleForeignCertificates.rows[0]
            ?.certificate_count,
        ).toBe("0");
      } finally {
        await rollbackApplicationTransaction(client);
        client.release();
      }
    });

    it("returns one stable certificate across repeated retries", async () => {
      const fixture = fixtures.retry;
      const client = await pool.connect();

      try {
        await beginApplicationTransaction(client, fixture);

        const certificates: CertificateRow[] = [];

        for (let attempt = 0; attempt < 5; attempt += 1) {
          certificates.push(
            await completeCourse(client, fixture),
          );
        }

        const certificateCount =
          await client.query<CertificateCountRow>(
            `
              SELECT count(*)::text AS certificate_count
              FROM nabuuma.academy_certificates
              WHERE organisation_id = $1
                AND learner_id = $2
                AND course_id = $3
            `,
            [
              fixture.organisationId,
              fixture.learnerId,
              fixture.courseId,
            ],
          );

        expect(
          new Set(
            certificates.map(
              (certificate) => certificate.id,
            ),
          ).size,
        ).toBe(1);

        expect(
          new Set(
            certificates.map(
              (certificate) =>
                certificate.certificate_number,
            ),
          ).size,
        ).toBe(1);

        expect(
          certificateCount.rows[0]?.certificate_count,
        ).toBe("1");
      } finally {
        await rollbackApplicationTransaction(client);
        client.release();
      }
    });
  },
);
