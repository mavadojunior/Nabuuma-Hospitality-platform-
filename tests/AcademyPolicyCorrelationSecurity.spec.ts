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
} from "pg";

interface Fixture {
  readonly tenantAOrganisationId: string;
  readonly tenantBOrganisationId: string;
  readonly learnerId: string;
  readonly tenantBCreatorId: string;
  readonly unpublishedCourseId: string;
  readonly publishedCourseId: string;
  readonly publishedLessonId: string;
}

const runRlsIntegration =
  process.env.RUN_RLS_INTEGRATION === "1";

const pool = new Pool({
  host: process.env.PGHOST ?? "localhost",
  port: Number(process.env.PGPORT ?? 55432),
  database:
    process.env.PGDATABASE ?? "nabuuma_test",
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
});

let fixture: Fixture;

async function beginLearnerContext(
  client: PoolClient,
  organisationId: string,
  learnerId: string,
): Promise<void> {
  await client.query("BEGIN");
  await client.query("SET ROLE nabuuma_app");

  await client.query(
    `
      SELECT
        set_config('app.user_id', $1, true),
        set_config('app.organisation_id', $2, true)
    `,
    [learnerId, organisationId],
  );
}

async function rollbackContext(
  client: PoolClient,
): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } finally {
    await client.query("RESET ROLE");
  }
}

async function seedFixture(): Promise<Fixture> {
  const client = await pool.connect();

  const tenantAOrganisationId = randomUUID();
  const tenantBOrganisationId = randomUUID();
  const learnerId = randomUUID();
  const tenantBCreatorId = randomUUID();
  const unpublishedCourseId = randomUUID();
  const publishedCourseId = randomUUID();
  const publishedLessonId = randomUUID();

  try {
    await client.query("BEGIN");

    await client.query(
      `
        INSERT INTO nabuuma.organisations
          (id, name, code, level)
        VALUES
          (
            $1,
            'Academy Policy Tenant A',
            $2,
            'TEAM'
          ),
          (
            $3,
            'Academy Policy Tenant B',
            $4,
            'TEAM'
          )
      `,
      [
        tenantAOrganisationId,
        `ACA-POL-A-${tenantAOrganisationId.slice(0, 8)}`,
        tenantBOrganisationId,
        `ACA-POL-B-${tenantBOrganisationId.slice(0, 8)}`,
      ],
    );

    await client.query(
      `
        INSERT INTO nabuuma.users
          (id, display_name, email)
        VALUES
          (
            $1,
            'Academy Policy Learner',
            $2
          ),
          (
            $3,
            'Academy Policy Tenant B Creator',
            $4
          )
      `,
      [
        learnerId,
        `academy-policy-learner-${learnerId}@example.test`,
        tenantBCreatorId,
        `academy-policy-creator-${tenantBCreatorId}@example.test`,
      ],
    );

    await client.query(
      `
        INSERT INTO nabuuma.organisation_memberships
          (
            organisation_id,
            user_id,
            role,
            is_active
          )
        VALUES
          ($1, $2, 'LEARNER', true),
          ($3, $4, 'MANAGER', true)
      `,
      [
        tenantAOrganisationId,
        learnerId,
        tenantBOrganisationId,
        tenantBCreatorId,
      ],
    );

    /*
     * Tenant A deliberately has only an unpublished course.
     * Tenant B supplies a published cross-tenant decoy course.
     */
    await client.query(
      `
        INSERT INTO nabuuma.academy_courses
          (
            id,
            organisation_id,
            stable_key,
            title,
            is_published,
            created_by_id
          )
        VALUES
          (
            $1,
            $2,
            $3,
            'Unpublished Tenant A Course',
            false,
            $4
          ),
          (
            $5,
            $6,
            $7,
            'Published Cross-Tenant Decoy Course',
            true,
            $8
          )
      `,
      [
        unpublishedCourseId,
        tenantAOrganisationId,
        `academy.policy.unpublished.${unpublishedCourseId}`,
        learnerId,
        publishedCourseId,
        tenantBOrganisationId,
        `academy.policy.published.${publishedCourseId}`,
        tenantBCreatorId,
      ],
    );

    /*
     * The lesson itself is published, but its correlated
     * Tenant A course is not published.
     */
    await client.query(
      `
        INSERT INTO nabuuma.academy_lessons
          (
            id,
            organisation_id,
            course_id,
            stable_key,
            title,
            sequence_number,
            is_published
          )
        VALUES
          (
            $1,
            $2,
            $3,
            $4,
            'Published Lesson on Unpublished Course',
            1,
            true
          )
      `,
      [
        publishedLessonId,
        tenantAOrganisationId,
        unpublishedCourseId,
        `academy.policy.lesson.${publishedLessonId}`,
      ],
    );

    await client.query("COMMIT");

    return {
      tenantAOrganisationId,
      tenantBOrganisationId,
      learnerId,
      tenantBCreatorId,
      unpublishedCourseId,
      publishedCourseId,
      publishedLessonId,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function cleanupFixture(
  value: Fixture,
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `
        DELETE FROM nabuuma.organisations
        WHERE id IN ($1, $2)
      `,
      [
        value.tenantAOrganisationId,
        value.tenantBOrganisationId,
      ],
    );

    await client.query(
      `
        DELETE FROM nabuuma.users
        WHERE id IN ($1, $2)
      `,
      [
        value.learnerId,
        value.tenantBCreatorId,
      ],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  if (!runRlsIntegration) {
    return;
  }

  fixture = await seedFixture();
});

afterAll(async () => {
  if (!runRlsIntegration) {
    await pool.end();
    return;
  }

  try {
    await cleanupFixture(fixture);
  } finally {
    await pool.end();
  }
});

describe.skipIf(!runRlsIntegration)(
  "Academy tenant policy correlation security",
  () => {
    /*
     * Regression contract:
     * academy_lessons_select must not use a published
     * cross-tenant course to authorise a lesson whose
     * correlated same-tenant course is unpublished.
     */
    it("academy_lessons_select rejects a published lesson whose correlated course is unpublished despite a cross-tenant published course", async () => {
      const client = await pool.connect();

      try {
        await beginLearnerContext(
          client,
          fixture.tenantAOrganisationId,
          fixture.learnerId,
        );

        const result = await client.query<{
          id: string;
        }>(
          `
            SELECT id
            FROM nabuuma.academy_lessons
            WHERE id = $1
          `,
          [fixture.publishedLessonId],
        );

        expect(result.rows).toEqual([]);
      } finally {
        await rollbackContext(client);
        client.release();
      }
    });

    /*
     * Regression contract:
     * academy_enrolments_insert must not use a published
     * cross-tenant course to authorise enrolment into an
     * unpublished same-tenant course.
     */
    it("academy_enrolments_insert rejects enrolment into an unpublished course despite a cross-tenant published course", async () => {
      const client = await pool.connect();

      try {
        await beginLearnerContext(
          client,
          fixture.tenantAOrganisationId,
          fixture.learnerId,
        );

        await expect(
          client.query(
            `
              INSERT INTO nabuuma.academy_enrolments
                (
                  organisation_id,
                  learner_id,
                  course_id,
                  status
                )
              VALUES ($1, $2, $3, 'ACTIVE')
            `,
            [
              fixture.tenantAOrganisationId,
              fixture.learnerId,
              fixture.unpublishedCourseId,
            ],
          ),
        ).rejects.toMatchObject({
          code: "42501",
        });
      } finally {
        await rollbackContext(client);
        client.release();
      }
    });
  },
);
