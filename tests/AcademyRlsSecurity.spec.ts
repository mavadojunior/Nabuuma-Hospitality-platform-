import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { Pool, type PoolClient } from "pg";

interface AcademyTenantFixture {
  organisationId: string;
  learnerId: string;
  alternateLearnerId?: string;
  courseId: string;
  lessonId: string;
  alternateLessonId?: string;
  enrolmentId: string;
  progressId: string;
}

interface AcademyFixtures {
  tenantA: AcademyTenantFixture;
  tenantB: AcademyTenantFixture;
  userIds: readonly string[];
}

const pool = new Pool({
  host: process.env.PGHOST ?? "localhost",
  port: Number(process.env.PGPORT ?? 55432),
  database: process.env.PGDATABASE ?? "nabuuma_test",
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
});

async function beginRlsContext(
  client: PoolClient,
  organisationId: string,
  userId: string,
): Promise<void> {
  await client.query("BEGIN");
  await client.query("SET ROLE nabuuma_app");

  await client.query(
    `
      SELECT
        set_config('app.user_id', $1, true),
        set_config('app.organisation_id', $2, true)
    `,
    [userId, organisationId],
  );
}

async function rollbackRlsContext(
  client: PoolClient,
): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } finally {
    await client.query("RESET ROLE");
  }
}

async function seedFixtures(): Promise<AcademyFixtures> {
  const client = await pool.connect();

  const tenantAOrganisationId = randomUUID();
  const tenantBOrganisationId = randomUUID();

  const learnerAId = randomUUID();
  const alternateLearnerAId = randomUUID();
  const learnerBId = randomUUID();

  const courseAId = randomUUID();
  const courseBId = randomUUID();

  const lessonAId = randomUUID();
  const alternateLessonAId = randomUUID();
  const lessonBId = randomUUID();

  const enrolmentAId = randomUUID();
  const enrolmentBId = randomUUID();

  const progressAId = randomUUID();
  const progressBId = randomUUID();

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
          ($1, 'Academy RLS Tenant A', $2, 'TEAM'),
          ($3, 'Academy RLS Tenant B', $4, 'TEAM')
      `,
      [
        tenantAOrganisationId,
        `ACADEMY-A-${tenantAOrganisationId.slice(0, 8)}`,
        tenantBOrganisationId,
        `ACADEMY-B-${tenantBOrganisationId.slice(0, 8)}`,
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
          ($1, 'Academy Learner A', $2),
          ($3, 'Academy Alternate Learner A', $4),
          ($5, 'Academy Learner B', $6)
      `,
      [
        learnerAId,
        `academy-a-${learnerAId}@example.test`,
        alternateLearnerAId,
        `academy-a2-${alternateLearnerAId}@example.test`,
        learnerBId,
        `academy-b-${learnerBId}@example.test`,
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
          ($1, $3, 'LEARNER', true),
          ($4, $5, 'LEARNER', true)
      `,
      [
        tenantAOrganisationId,
        learnerAId,
        alternateLearnerAId,
        tenantBOrganisationId,
        learnerBId,
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
            'Academy Course A',
            'Tenant A security fixture',
            true,
            $4
          ),
          (
            $5,
            $6,
            $7,
            1,
            'Academy Course B',
            'Tenant B security fixture',
            true,
            $8
          )
      `,
      [
        courseAId,
        tenantAOrganisationId,
        `academy.course.a.${courseAId}`,
        learnerAId,
        courseBId,
        tenantBOrganisationId,
        `academy.course.b.${courseBId}`,
        learnerBId,
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
            'Academy Lesson A',
            '{}'::jsonb,
            1,
            true
          ),
          (
            $5,
            $2,
            $3,
            $6,
            'Academy Alternate Lesson A',
            '{}'::jsonb,
            2,
            true
          ),
          (
            $7,
            $8,
            $9,
            $10,
            'Academy Lesson B',
            '{}'::jsonb,
            1,
            true
          )
      `,
      [
        lessonAId,
        tenantAOrganisationId,
        courseAId,
        `academy.lesson.a.${lessonAId}`,
        alternateLessonAId,
        `academy.lesson.a2.${alternateLessonAId}`,
        lessonBId,
        tenantBOrganisationId,
        courseBId,
        `academy.lesson.b.${lessonBId}`,
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
        VALUES
          ($1, $2, $3, $4, 'ACTIVE'),
          ($5, $6, $7, $8, 'ACTIVE')
      `,
      [
        enrolmentAId,
        tenantAOrganisationId,
        learnerAId,
        courseAId,
        enrolmentBId,
        tenantBOrganisationId,
        learnerBId,
        courseBId,
      ],
    );

    await client.query(
      `
        INSERT INTO nabuuma.academy_lesson_progress (
          id,
          organisation_id,
          learner_id,
          course_id,
          enrolment_id,
          lesson_id,
          status,
          progress_percent,
          started_at
        )
        VALUES
          (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            'IN_PROGRESS',
            50,
            now()
          ),
          (
            $7,
            $8,
            $9,
            $10,
            $11,
            $12,
            'IN_PROGRESS',
            50,
            now()
          )
      `,
      [
        progressAId,
        tenantAOrganisationId,
        learnerAId,
        courseAId,
        enrolmentAId,
        lessonAId,
        progressBId,
        tenantBOrganisationId,
        learnerBId,
        courseBId,
        enrolmentBId,
        lessonBId,
      ],
    );

    await client.query("COMMIT");

    return {
      tenantA: {
        organisationId: tenantAOrganisationId,
        learnerId: learnerAId,
        alternateLearnerId: alternateLearnerAId,
        courseId: courseAId,
        lessonId: lessonAId,
        alternateLessonId: alternateLessonAId,
        enrolmentId: enrolmentAId,
        progressId: progressAId,
      },
      tenantB: {
        organisationId: tenantBOrganisationId,
        learnerId: learnerBId,
        courseId: courseBId,
        lessonId: lessonBId,
        enrolmentId: enrolmentBId,
        progressId: progressBId,
      },
      userIds: [
        learnerAId,
        alternateLearnerAId,
        learnerBId,
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
  fixtures: AcademyFixtures,
): Promise<void> {
  const client = await pool.connect();

  const organisationIds = [
    fixtures.tenantA.organisationId,
    fixtures.tenantB.organisationId,
  ];

  try {
    await client.query("BEGIN");

    /*
     * Delete Academy children explicitly before organisations.
     *
     * academy_enrolments -> academy_courses uses ON DELETE RESTRICT,
     * so deleting organisations first would cascade to courses while
     * enrolments still reference those courses.
     */
    await client.query(
      `
        DELETE FROM nabuuma.academy_lesson_progress
        WHERE organisation_id = ANY($1::uuid[])
      `,
      [organisationIds],
    );

    await client.query(
      `
        DELETE FROM nabuuma.academy_certificates
        WHERE organisation_id = ANY($1::uuid[])
      `,
      [organisationIds],
    );

    await client.query(
      `
        DELETE FROM nabuuma.academy_enrolments
        WHERE organisation_id = ANY($1::uuid[])
      `,
      [organisationIds],
    );

    await client.query(
      `
        DELETE FROM nabuuma.academy_lessons
        WHERE organisation_id = ANY($1::uuid[])
      `,
      [organisationIds],
    );

    await client.query(
      `
        DELETE FROM nabuuma.academy_courses
        WHERE organisation_id = ANY($1::uuid[])
      `,
      [organisationIds],
    );

    await client.query(
      `
        DELETE FROM nabuuma.organisations
        WHERE id = ANY($1::uuid[])
      `,
      [organisationIds],
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

const runRlsIntegration =
  process.env.RUN_RLS_INTEGRATION === "1";

let fixtures: AcademyFixtures;

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
  "Academy RLS security",
  () => {
    it("allows a learner to read published curriculum in the active tenant", async () => {
      const client = await pool.connect();

      try {
        await beginRlsContext(
          client,
          fixtures.tenantA.organisationId,
          fixtures.tenantA.learnerId,
        );

        const result = await client.query(
          `
            SELECT id
            FROM nabuuma.academy_lessons
            WHERE course_id = $1
            ORDER BY sequence_number
          `,
          [fixtures.tenantA.courseId],
        );

        expect(result.rows.map((row) => row.id)).toEqual([
          fixtures.tenantA.lessonId,
          fixtures.tenantA.alternateLessonId,
        ]);
      } finally {
        await rollbackRlsContext(client);
        client.release();
      }
    });

    it("hides curriculum from another tenant", async () => {
      const client = await pool.connect();

      try {
        await beginRlsContext(
          client,
          fixtures.tenantA.organisationId,
          fixtures.tenantA.learnerId,
        );

        const result = await client.query(
          `
            SELECT id
            FROM nabuuma.academy_lessons
            WHERE course_id = $1
          `,
          [fixtures.tenantB.courseId],
        );

        expect(result.rowCount).toBe(0);
      } finally {
        await rollbackRlsContext(client);
        client.release();
      }
    });

    it("allows a learner to read their own enrolment and progress", async () => {
      const client = await pool.connect();

      try {
        await beginRlsContext(
          client,
          fixtures.tenantA.organisationId,
          fixtures.tenantA.learnerId,
        );

        const enrolment = await client.query(
          `
            SELECT id
            FROM nabuuma.academy_enrolments
            WHERE id = $1
          `,
          [fixtures.tenantA.enrolmentId],
        );

        const progress = await client.query(
          `
            SELECT id, progress_percent
            FROM nabuuma.academy_lesson_progress
            WHERE id = $1
          `,
          [fixtures.tenantA.progressId],
        );

        expect(enrolment.rowCount).toBe(1);
        expect(progress.rows[0]).toEqual({
          id: fixtures.tenantA.progressId,
          progress_percent: 50,
        });
      } finally {
        await rollbackRlsContext(client);
        client.release();
      }
    });

    it("hides another learner's enrolment and progress in the same tenant", async () => {
      const client = await pool.connect();

      try {
        await beginRlsContext(
          client,
          fixtures.tenantA.organisationId,
          fixtures.tenantA.alternateLearnerId!,
        );

        const enrolment = await client.query(
          `
            SELECT id
            FROM nabuuma.academy_enrolments
            WHERE id = $1
          `,
          [fixtures.tenantA.enrolmentId],
        );

        const progress = await client.query(
          `
            SELECT id
            FROM nabuuma.academy_lesson_progress
            WHERE id = $1
          `,
          [fixtures.tenantA.progressId],
        );

        expect(enrolment.rowCount).toBe(0);
        expect(progress.rowCount).toBe(0);
      } finally {
        await rollbackRlsContext(client);
        client.release();
      }
    });

    it("allows a learner to update their own progress", async () => {
      const client = await pool.connect();

      try {
        await beginRlsContext(
          client,
          fixtures.tenantA.organisationId,
          fixtures.tenantA.learnerId,
        );

        const result = await client.query(
          `
            UPDATE nabuuma.academy_lesson_progress
            SET
              progress_percent = 75,
              status = 'IN_PROGRESS',
              last_activity_at = now()
            WHERE id = $1
            RETURNING progress_percent
          `,
          [fixtures.tenantA.progressId],
        );

        expect(result.rows[0]?.progress_percent).toBe(75);
      } finally {
        await rollbackRlsContext(client);
        client.release();
      }
    });

    it("prevents another learner from updating progress in the same tenant", async () => {
      const client = await pool.connect();

      try {
        await beginRlsContext(
          client,
          fixtures.tenantA.organisationId,
          fixtures.tenantA.alternateLearnerId!,
        );

        const result = await client.query(
          `
            UPDATE nabuuma.academy_lesson_progress
            SET
              progress_percent = 75,
              status = 'IN_PROGRESS',
              last_activity_at = now()
            WHERE id = $1
            RETURNING id
          `,
          [fixtures.tenantA.progressId],
        );

        expect(result.rowCount).toBe(0);
      } finally {
        await rollbackRlsContext(client);
        client.release();
      }
    });

    it("rejects inserting progress for another tenant", async () => {
      const client = await pool.connect();

      try {
        await beginRlsContext(
          client,
          fixtures.tenantA.organisationId,
          fixtures.tenantA.learnerId,
        );

        await expect(
          client.query(
            `
              INSERT INTO nabuuma.academy_lesson_progress (
                organisation_id,
                learner_id,
                course_id,
                enrolment_id,
                lesson_id,
                status,
                progress_percent,
                started_at
              )
              VALUES (
                $1,
                $2,
                $3,
                $4,
                $5,
                'IN_PROGRESS',
                25,
                now()
              )
            `,
            [
              fixtures.tenantB.organisationId,
              fixtures.tenantB.learnerId,
              fixtures.tenantB.courseId,
              fixtures.tenantB.enrolmentId,
              fixtures.tenantB.lessonId,
            ],
          ),
        ).rejects.toMatchObject({
          code: "42501",
        });
      } finally {
        await rollbackRlsContext(client);
        client.release();
      }
    });
  },
);
