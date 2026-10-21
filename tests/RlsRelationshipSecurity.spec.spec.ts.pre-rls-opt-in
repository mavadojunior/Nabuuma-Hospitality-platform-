import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

import {
  DomainConstraintError,
  TenantBoundaryViolationError,
} from "../src/domain/competency/errors";
import { mapPgError } from "../src/infrastructure/database/error-mapping";

type TenantFixture = {
  organisationId: string;
  assessorId: string;
  learnerId: string;
  alternateLearnerId?: string;
  competencyDefinitionId: string;
  learnerCompetencyId: string;
  practiceSessionId: string;
  alternatePracticeSessionId?: string;
};

type Fixtures = {
  tenantA: TenantFixture;
  tenantB: TenantFixture;
  telemetryDefinitionId: string;
};

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

async function rollbackRlsContext(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } finally {
    await client.query("RESET ROLE");
  }
}

async function expectMappedDatabaseError(
  operation: "telemetry" | "assessment" | "competency",
  work: () => Promise<unknown>,
  expected:
    | typeof TenantBoundaryViolationError
    | typeof DomainConstraintError,
): Promise<void> {
  try {
    await work();
    throw new Error("Expected database operation to be rejected.");
  } catch (error) {
    if (error instanceof Error && error.message === "Expected database operation to be rejected.") {
      throw error;
    }

    const mapped = mapPgError(error, operation);
    expect(mapped).toBeInstanceOf(expected);
  }
}

async function seedFixtures(): Promise<Fixtures> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const tenantAOrgId = randomUUID();
    const tenantBOrgId = randomUUID();

    const assessorAId = randomUUID();
    const learnerAId = randomUUID();
    const alternateLearnerAId = randomUUID();

    const assessorBId = randomUUID();
    const learnerBId = randomUUID();

    await client.query(
      `
        INSERT INTO nabuuma.organisations (id, name, code, level)
        VALUES
          ($1, 'RLS Security Test Tenant A', $2, 'TEAM'),
          ($3, 'RLS Security Test Tenant B', $4, 'TEAM')
      `,
      [tenantAOrgId, `RLS-A-${tenantAOrgId.slice(0, 8)}`, tenantBOrgId, `RLS-B-${tenantBOrgId.slice(0, 8)}`],
    );

    await client.query(
      `
        INSERT INTO nabuuma.users (id, display_name, email)
        VALUES
          ($1, 'RLS Assessor A', $2),
          ($3, 'RLS Learner A', $4),
          ($5, 'RLS Alternate Learner A', $6),
          ($7, 'RLS Assessor B', $8),
          ($9, 'RLS Learner B', $10)
      `,
      [
        assessorAId,
        `rls-assessor-a-${assessorAId}@example.test`,
        learnerAId,
        `rls-learner-a-${learnerAId}@example.test`,
        alternateLearnerAId,
        `rls-learner-a2-${alternateLearnerAId}@example.test`,
        assessorBId,
        `rls-assessor-b-${assessorBId}@example.test`,
        learnerBId,
        `rls-learner-b-${learnerBId}@example.test`,
      ],
    );

    await client.query(
      `
        INSERT INTO nabuuma.organisation_memberships
          (organisation_id, user_id, role, is_active)
        VALUES
          ($1, $2, 'ASSESSOR', true),
          ($1, $3, 'LEARNER', true),
          ($1, $4, 'LEARNER', true),
          ($5, $6, 'ASSESSOR', true),
          ($5, $7, 'LEARNER', true)
      `,
      [
        tenantAOrgId,
        assessorAId,
        learnerAId,
        alternateLearnerAId,
        tenantBOrgId,
        assessorBId,
        learnerBId,
      ],
    );

    const competencyDefinitionAId = randomUUID();
    const competencyDefinitionBId = randomUUID();

    await client.query(
      `
        INSERT INTO nabuuma.competency_definitions
          (id, organisation_id, stable_key, version, name, description)
        VALUES
          ($1, $2, $3, 1, 'RLS Test Competency A', 'RLS relationship security fixture'),
          ($4, $5, $6, 1, 'RLS Test Competency B', 'RLS relationship security fixture')
      `,
      [
        competencyDefinitionAId,
        tenantAOrgId,
        `rls.test.a.${competencyDefinitionAId}`,
        competencyDefinitionBId,
        tenantBOrgId,
        `rls.test.b.${competencyDefinitionBId}`,
      ],
    );

    const learnerCompetencyAId = randomUUID();
    const learnerCompetencyBId = randomUUID();

    await client.query(
      `
        INSERT INTO nabuuma.learner_competencies
          (id, organisation_id, learner_id, competency_definition_id)
        VALUES
          ($1, $2, $3, $4),
          ($5, $6, $7, $8)
      `,
      [
        learnerCompetencyAId,
        tenantAOrgId,
        learnerAId,
        competencyDefinitionAId,
        learnerCompetencyBId,
        tenantBOrgId,
        learnerBId,
        competencyDefinitionBId,
      ],
    );

    const alternateLearnerCompetencyAId = randomUUID();

    await client.query(
      `
        INSERT INTO nabuuma.learner_competencies
          (id, organisation_id, learner_id, competency_definition_id)
        VALUES ($1, $2, $3, $4)
      `,
      [
        alternateLearnerCompetencyAId,
        tenantAOrgId,
        alternateLearnerAId,
        competencyDefinitionAId,
      ],
    );

    const practiceSessionAId = randomUUID();
    const alternatePracticeSessionAId = randomUUID();
    const practiceSessionBId = randomUUID();

    await client.query(
      `
        INSERT INTO nabuuma.practice_sessions
          (id, organisation_id, learner_id, competency_id, status)
        VALUES
          ($1, $2, $3, $4, 'PLANNED'),
          ($5, $6, $7, $8, 'PLANNED'),
          ($9, $10, $11, $12, 'PLANNED')
      `,
      [
        practiceSessionAId,
        tenantAOrgId,
        learnerAId,
        learnerCompetencyAId,
        alternatePracticeSessionAId,
        tenantAOrgId,
        alternateLearnerAId,
        alternateLearnerCompetencyAId,
        practiceSessionBId,
        tenantBOrgId,
        learnerBId,
        learnerCompetencyBId,
      ],
    );

    const telemetryDefinitionId = randomUUID();

    await client.query(
      `
        INSERT INTO nabuuma.telemetry_definitions
          (id, stable_key, version, name, value_type, canonical_unit)
        VALUES
          ($1, $2, 1, 'RLS Test Telemetry', 'DECIMAL', 'g')
      `,
      [telemetryDefinitionId, `rls.test.telemetry.${telemetryDefinitionId}`],
    );

    await client.query("COMMIT");

    return {
      tenantA: {
        organisationId: tenantAOrgId,
        assessorId: assessorAId,
        learnerId: learnerAId,
        alternateLearnerId: alternateLearnerAId,
        competencyDefinitionId: competencyDefinitionAId,
        learnerCompetencyId: learnerCompetencyAId,
        practiceSessionId: practiceSessionAId,
        alternatePracticeSessionId: alternatePracticeSessionAId,
      },
      tenantB: {
        organisationId: tenantBOrgId,
        assessorId: assessorBId,
        learnerId: learnerBId,
        competencyDefinitionId: competencyDefinitionBId,
        learnerCompetencyId: learnerCompetencyBId,
        practiceSessionId: practiceSessionBId,
      },
      telemetryDefinitionId,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function cleanupFixtures(fixtures: Fixtures): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `
        DELETE FROM nabuuma.organisations
        WHERE id IN ($1, $2)
      `,
      [fixtures.tenantA.organisationId, fixtures.tenantB.organisationId],
    );

    await client.query(
      `
        DELETE FROM nabuuma.telemetry_definitions
        WHERE id = $1
      `,
      [fixtures.telemetryDefinitionId],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

let fixtures: Fixtures;

beforeAll(async () => {
  fixtures = await seedFixtures();
});

afterAll(async () => {
  try {
    await cleanupFixtures(fixtures);
  } finally {
    await pool.end();
  }
});

describe("RLS relationship security", () => {
  it("allows valid telemetry within the active tenant and practice session", async () => {
    const client = await pool.connect();

    try {
      await beginRlsContext(
        client,
        fixtures.tenantA.organisationId,
        fixtures.tenantA.assessorId,
      );

      const result = await client.query(
        `
          INSERT INTO nabuuma.telemetry_observations
            (
              organisation_id,
              practice_session_id,
              telemetry_definition_id,
              observed_by_id,
              value_numeric,
              unit,
              quality_status
            )
          VALUES ($1, $2, $3, $4, 18, 'g', 'VALID')
          RETURNING id
        `,
        [
          fixtures.tenantA.organisationId,
          fixtures.tenantA.practiceSessionId,
          fixtures.telemetryDefinitionId,
          fixtures.tenantA.assessorId,
        ],
      );

      expect(result.rowCount).toBe(1);
    } finally {
      await rollbackRlsContext(client);
      client.release();
    }
  });

  it("rejects telemetry whose practice session belongs to another tenant", async () => {
    const client = await pool.connect();

    try {
      await beginRlsContext(
        client,
        fixtures.tenantA.organisationId,
        fixtures.tenantA.assessorId,
      );

      await expectMappedDatabaseError(
        "telemetry",
        () =>
          client.query(
            `
              INSERT INTO nabuuma.telemetry_observations
                (
                  organisation_id,
                  practice_session_id,
                  telemetry_definition_id,
                  observed_by_id,
                  value_numeric,
                  unit,
                  quality_status
                )
              VALUES ($1, $2, $3, $4, 18, 'g', 'VALID')
            `,
            [
              fixtures.tenantA.organisationId,
              fixtures.tenantB.practiceSessionId,
              fixtures.telemetryDefinitionId,
              fixtures.tenantA.assessorId,
            ],
          ),
        TenantBoundaryViolationError,
      );
    } finally {
      await rollbackRlsContext(client);
      client.release();
    }
  });

  it("allows valid evidence within the active tenant and learner practice session", async () => {
    const client = await pool.connect();

    try {
      await beginRlsContext(
        client,
        fixtures.tenantA.organisationId,
        fixtures.tenantA.assessorId,
      );

      const result = await client.query(
        `
          INSERT INTO nabuuma.evidence_records
            (
              organisation_id,
              learner_id,
              practice_session_id,
              title,
              status
            )
          VALUES ($1, $2, $3, 'Valid RLS evidence', 'DRAFT')
          RETURNING id
        `,
        [
          fixtures.tenantA.organisationId,
          fixtures.tenantA.learnerId,
          fixtures.tenantA.practiceSessionId,
        ],
      );

      expect(result.rowCount).toBe(1);
    } finally {
      await rollbackRlsContext(client);
      client.release();
    }
  });

  it("rejects evidence whose organisation does not match the active tenant", async () => {
    const client = await pool.connect();

    try {
      await beginRlsContext(
        client,
        fixtures.tenantA.organisationId,
        fixtures.tenantA.assessorId,
      );

      await expectMappedDatabaseError(
        "assessment",
        () =>
          client.query(
            `
              INSERT INTO nabuuma.evidence_records
                (
                  organisation_id,
                  learner_id,
                  practice_session_id,
                  title,
                  status
                )
              VALUES ($1, $2, $3, 'Cross-tenant evidence', 'DRAFT')
            `,
            [
              fixtures.tenantB.organisationId,
              fixtures.tenantA.learnerId,
              fixtures.tenantA.practiceSessionId,
            ],
          ),
        TenantBoundaryViolationError,
      );
    } finally {
      await rollbackRlsContext(client);
      client.release();
    }
  });

  it("rejects evidence referencing a practice session from another tenant", async () => {
    const client = await pool.connect();

    try {
      await beginRlsContext(
        client,
        fixtures.tenantA.organisationId,
        fixtures.tenantA.assessorId,
      );

      await expectMappedDatabaseError(
        "assessment",
        () =>
          client.query(
            `
              INSERT INTO nabuuma.evidence_records
                (
                  organisation_id,
                  learner_id,
                  practice_session_id,
                  title,
                  status
                )
              VALUES ($1, $2, $3, 'Foreign practice session', 'DRAFT')
            `,
            [
              fixtures.tenantA.organisationId,
              fixtures.tenantA.learnerId,
              fixtures.tenantB.practiceSessionId,
            ],
          ),
        TenantBoundaryViolationError,
      );
    } finally {
      await rollbackRlsContext(client);
      client.release();
    }
  });

  it("rejects evidence when the practice session belongs to a different learner in the same tenant", async () => {
    const client = await pool.connect();

    try {
      await beginRlsContext(
        client,
        fixtures.tenantA.organisationId,
        fixtures.tenantA.assessorId,
      );

      await expectMappedDatabaseError(
        "assessment",
        () =>
          client.query(
            `
              INSERT INTO nabuuma.evidence_records
                (
                  organisation_id,
                  learner_id,
                  practice_session_id,
                  title,
                  status
                )
              VALUES ($1, $2, $3, 'Wrong learner practice session', 'DRAFT')
            `,
            [
              fixtures.tenantA.organisationId,
              fixtures.tenantA.learnerId,
              fixtures.tenantA.alternatePracticeSessionId,
            ],
          ),
        TenantBoundaryViolationError,
      );
    } finally {
      await rollbackRlsContext(client);
      client.release();
    }
  });
});
