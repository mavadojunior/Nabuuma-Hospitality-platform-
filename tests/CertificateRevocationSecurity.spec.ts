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

const runIntegration =
  process.env.RUN_RLS_INTEGRATION === "1";

const pool = new Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 55432),
  database: process.env.PGDATABASE ?? "nabuuma_test",
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
});

interface Fixture {
  readonly organisationId: string;
  readonly actorId: string;
  readonly learnerId: string;
  readonly courseId: string;
  readonly enrolmentId: string;
  readonly certificateId: string;
  readonly certificateNumber: string;
}

interface RevokeRow extends QueryResultRow {
  readonly certificate_number: string;
  readonly revoked_at: Date | string;
  readonly newly_revoked: boolean;
}

interface VerifyRow extends QueryResultRow {
  readonly valid: boolean;
  readonly status: "VALID" | "REVOKED";
  readonly certificate_number: string;
  readonly revoked_at: Date | string | null;
}

function fixture(label: string): Fixture {
  return {
    organisationId: randomUUID(),
    actorId: randomUUID(),
    learnerId: randomUUID(),
    courseId: randomUUID(),
    enrolmentId: randomUUID(),
    certificateId: randomUUID(),
    certificateNumber:
      `NAB-${label}-${randomUUID().replaceAll("-", "")}`,
  };
}

const primary = fixture("REVOKE");
const foreign = fixture("FOREIGN");

async function seed(
  client: PoolClient,
  value: Fixture,
  actorRole: "ASSESSOR" | "LEARNER",
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
      value.organisationId,
      `Revocation Tenant ${value.organisationId}`,
      `REV-${value.organisationId.slice(0, 8)}`,
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
        ($1, 'Revocation Actor', $3),
        ($2, 'Revocation Learner', $4)
    `,
    [
      value.actorId,
      value.learnerId,
      `actor-${value.actorId}@example.test`,
      `learner-${value.learnerId}@example.test`,
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
        ($1, $2, $4, true),
        ($1, $3, 'LEARNER', true)
    `,
    [
      value.organisationId,
      value.actorId,
      value.learnerId,
      actorRole,
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
        'Revocation Course',
        'Certificate revocation fixture',
        true,
        $4
      )
    `,
    [
      value.courseId,
      value.organisationId,
      `revocation.${value.courseId}`,
      value.actorId,
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
      VALUES (
        $1,
        $2,
        $3,
        $4,
        'COMPLETED',
        now()
      )
    `,
    [
      value.enrolmentId,
      value.organisationId,
      value.learnerId,
      value.courseId,
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
        certificate_number
      )
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      value.certificateId,
      value.organisationId,
      value.learnerId,
      value.courseId,
      value.enrolmentId,
      value.certificateNumber,
    ],
  );

  if (actorRole === "ASSESSOR") {
    await client.query(
      `
        INSERT INTO nabuuma.trainer_learner_authorizations (
          organisation_id,
          trainer_id,
          learner_id,
          is_active,
          authorized_by_id
        )
        VALUES ($1, $2, $3, true, $2)
      `,
      [
        value.organisationId,
        value.actorId,
        value.learnerId,
      ],
    );
  }
}

async function applicationTransaction(
  client: PoolClient,
  value: Fixture,
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
      value.actorId,
      value.organisationId,
    ],
  );
}

async function rollback(
  client: PoolClient,
): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } finally {
    await client.query("RESET ROLE");
  }
}

beforeAll(async () => {
  if (!runIntegration) {
    return;
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await seed(client, primary, "ASSESSOR");
    await seed(client, foreign, "ASSESSOR");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

afterAll(async () => {
  try {
    if (runIntegration) {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        await client.query(
          `
            DELETE FROM nabuuma.academy_certificates
            WHERE organisation_id = ANY($1::uuid[])
          `,
          [[primary.organisationId, foreign.organisationId]],
        );

        await client.query(
          `
            DELETE FROM nabuuma.academy_enrolments
            WHERE organisation_id = ANY($1::uuid[])
          `,
          [[primary.organisationId, foreign.organisationId]],
        );

        await client.query(
          `
            DELETE FROM nabuuma.academy_courses
            WHERE organisation_id = ANY($1::uuid[])
          `,
          [[primary.organisationId, foreign.organisationId]],
        );

        await client.query(
          `
            DELETE FROM nabuuma.trainer_learner_authorizations
            WHERE organisation_id = ANY($1::uuid[])
          `,
          [[primary.organisationId, foreign.organisationId]],
        );

        await client.query(
          `
            DELETE FROM nabuuma.organisation_memberships
            WHERE organisation_id = ANY($1::uuid[])
          `,
          [[primary.organisationId, foreign.organisationId]],
        );

        await client.query(
          `
            DELETE FROM nabuuma.organisations
            WHERE id = ANY($1::uuid[])
          `,
          [[primary.organisationId, foreign.organisationId]],
        );

        await client.query(
          `
            DELETE FROM nabuuma.users
            WHERE id = ANY($1::uuid[])
          `,
          [[
            primary.actorId,
            primary.learnerId,
            foreign.actorId,
            foreign.learnerId,
          ]],
        );

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
});

describe.skipIf(!runIntegration)(
  "Certificate revocation security",
  () => {
    it("revokes once and is idempotent on retry", async () => {
      const client = await pool.connect();

      try {
        await applicationTransaction(client, primary);

        const first = await client.query<RevokeRow>(
          `
            SELECT *
            FROM nabuuma.revoke_academy_certificate(
              $1,
              $2
            )
          `,
          [
            primary.certificateNumber,
            "Administrative revocation",
          ],
        );

        const second = await client.query<RevokeRow>(
          `
            SELECT *
            FROM nabuuma.revoke_academy_certificate(
              $1,
              $2
            )
          `,
          [
            primary.certificateNumber,
            "Administrative revocation",
          ],
        );

        expect(first.rows[0]?.newly_revoked).toBe(true);
        expect(second.rows[0]?.newly_revoked).toBe(false);

        expect(
          second.rows[0]?.revoked_at,
        ).toEqual(first.rows[0]?.revoked_at);
      } finally {
        await rollback(client);
        client.release();
      }
    });

    it("public verification reports revoked without private data", async () => {
      const client = await pool.connect();

      try {
        await applicationTransaction(client, primary);

        await client.query(
          `
            SELECT *
            FROM nabuuma.revoke_academy_certificate(
              $1,
              'Verification contract'
            )
          `,
          [primary.certificateNumber],
        );

        await client.query("SET LOCAL ROLE NONE");
        await client.query(
          "SET LOCAL ROLE nabuuma_certificate_verifier",
        );

        const result = await client.query<VerifyRow>(
          `
            SELECT *
            FROM nabuuma.verify_academy_certificate($1)
          `,
          [primary.certificateNumber],
        );

        expect(result.rows[0]).toMatchObject({
          valid: false,
          status: "REVOKED",
          certificate_number: primary.certificateNumber,
        });

        expect(result.rows[0]?.revoked_at).not.toBeNull();

        expect(
          result.fields.map((field) => field.name),
        ).toEqual([
          "valid",
          "status",
          "certificate_number",
          "issued_at",
          "course_title",
          "revoked_at",
        ]);
      } finally {
        await rollback(client);
        client.release();
      }
    });

    it("rejects cross-tenant revocation", async () => {
      const client = await pool.connect();

      try {
        await applicationTransaction(client, primary);
        await client.query("SAVEPOINT revoke_attempt");

        await expect(
          client.query(
            `
              SELECT *
              FROM nabuuma.revoke_academy_certificate(
                $1,
                'Cross-tenant attempt'
              )
            `,
            [foreign.certificateNumber],
          ),
        ).rejects.toMatchObject({
          code: "P0002",
        });

        await client.query(
          "ROLLBACK TO SAVEPOINT revoke_attempt",
        );
      } finally {
        await rollback(client);
        client.release();
      }
    });

    it("rejects an unauthorised learner", async () => {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        await client.query("SET ROLE nabuuma_app");

        await client.query(
          `
            SELECT
              set_config('app.user_id', $1, true),
              set_config('app.organisation_id', $2, true)
          `,
          [
            primary.learnerId,
            primary.organisationId,
          ],
        );

        await client.query("SAVEPOINT revoke_attempt");

        await expect(
          client.query(
            `
              SELECT *
              FROM nabuuma.revoke_academy_certificate(
                $1,
                'Unauthorised attempt'
              )
            `,
            [primary.certificateNumber],
          ),
        ).rejects.toMatchObject({
          code: "42501",
        });

        await client.query(
          "ROLLBACK TO SAVEPOINT revoke_attempt",
        );
      } finally {
        await rollback(client);
        client.release();
      }
    });

    it("denies direct application access to the ledger", async () => {
      const client = await pool.connect();

      try {
        await applicationTransaction(client, primary);

        await expect(
          client.query(
            `
              SELECT id
              FROM nabuuma.academy_certificate_revocations
              LIMIT 1
            `,
          ),
        ).rejects.toMatchObject({
          code: "42501",
        });
      } finally {
        await rollback(client);
        client.release();
      }
    });
  },
);
