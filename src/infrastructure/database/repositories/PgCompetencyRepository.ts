import type { PoolClient } from "pg";
import type {
  CompetencyDefinition,
  CompetencyRepository,
  LearnerCompetency,
  UUID,
} from "../../../domain/competency/repositories/contracts";
import { DomainStateTransitionError, TenantBoundaryViolationError } from "../../../domain/competency/errors";
import type { PgExecutionContext } from "../transaction";
import { mapPgError } from "../error-mapping";

interface CompetencyDefinitionRow {
  id: string;
  organisation_id: string | null;
  stable_key: string;
  version: number;
  name: string;
  description: string;
  required_knowledge_node_ids: string[];
}

interface LearnerCompetencyRow {
  id: string;
  organisation_id: string;
  learner_id: string;
  competency_definition_id: string;
  state: LearnerCompetency["state"];
  assessment_id: string | null;
  verified_by_id: string | null;
  verified_at: Date | string | null;
}

function iso(value: Date | string | null): string | undefined {
  if (value === null) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

function mapLearnerCompetency(row: LearnerCompetencyRow): LearnerCompetency {
  const assessmentId = row.assessment_id ?? undefined;
  const verifiedById = row.verified_by_id ?? undefined;
  const verifiedAt = iso(row.verified_at);

  return {
    id: row.id,
    organisationId: row.organisation_id,
    learnerId: row.learner_id,
    competencyDefinitionId: row.competency_definition_id,
    state: row.state,
    ...(assessmentId === undefined ? {} : { assessmentId }),
    ...(verifiedById === undefined ? {} : { verifiedById }),
    ...(verifiedAt === undefined ? {} : { verifiedAt }),
  };
}

function ensureClient(context: PgExecutionContext): PoolClient {
  return context.client;
}

export class PgCompetencyRepository implements CompetencyRepository {
  constructor(private readonly context: PgExecutionContext) {}

  async getDefinition(id: UUID): Promise<CompetencyDefinition | null> {
    const client = ensureClient(this.context);

    try {
      const result = await client.query<CompetencyDefinitionRow>(
        `
          SELECT
            cd.id,
            cd.organisation_id,
            cd.stable_key,
            cd.version,
            cd.name,
            cd.description,
            COALESCE(
              array_agg(crn.knowledge_node_id)
                FILTER (WHERE crn.knowledge_node_id IS NOT NULL),
              ARRAY[]::uuid[]
            ) AS required_knowledge_node_ids
          FROM nabuuma.competency_definitions cd
          LEFT JOIN nabuuma.competency_required_nodes crn
            ON crn.competency_id = cd.id
          WHERE cd.id = $1
            AND (
              cd.organisation_id = $2
              OR cd.organisation_id IS NULL
            )
          GROUP BY
            cd.id,
            cd.organisation_id,
            cd.stable_key,
            cd.version,
            cd.name,
            cd.description
        `,
        [id, this.context.organisationId],
      );

      const row = result.rows[0];
      if (!row) return null;

      return {
        id: row.id,
        ...(row.organisation_id === null
          ? {}
          : { organisationId: row.organisation_id }),
        stableKey: row.stable_key,
        version: row.version,
        name: row.name,
        description: row.description,
        requiredKnowledgeNodeIds: row.required_knowledge_node_ids,
      };
    } catch (error) {
      throw mapPgError(error, "competency");
    }
  }

  async getLearnerCompetency(id: UUID): Promise<LearnerCompetency | null> {
    const client = ensureClient(this.context);

    try {
      const result = await client.query<LearnerCompetencyRow>(
        `
          SELECT
            id,
            organisation_id,
            learner_id,
            competency_definition_id,
            state,
            assessment_id,
            verified_by_id,
            verified_at
          FROM nabuuma.learner_competencies
          WHERE id = $1
            AND organisation_id = $2
        `,
        [id, this.context.organisationId],
      );

      const row = result.rows[0];
      return row ? mapLearnerCompetency(row) : null;
    } catch (error) {
      throw mapPgError(error, "competency");
    }
  }

  async createLearnerCompetency(
    competency: Omit<LearnerCompetency, "id">,
  ): Promise<LearnerCompetency> {
    if (competency.organisationId !== this.context.organisationId) {
      throw new TenantBoundaryViolationError();
    }

    try {
      const result = await this.context.client.query<LearnerCompetencyRow>(
        `
          INSERT INTO nabuuma.learner_competencies (
            organisation_id,
            learner_id,
            competency_definition_id,
            state,
            assessment_id,
            verified_by_id,
            verified_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING
            id,
            organisation_id,
            learner_id,
            competency_definition_id,
            state,
            assessment_id,
            verified_by_id,
            verified_at
        `,
        [
          competency.organisationId,
          competency.learnerId,
          competency.competencyDefinitionId,
          competency.state,
          competency.assessmentId ?? null,
          competency.verifiedById ?? null,
          competency.verifiedAt ?? null,
        ],
      );

      const row = result.rows[0];
      if (!row) {
        throw new DomainStateTransitionError(
          "The learner competency could not be created.",
        );
      }

      return mapLearnerCompetency(row);
    } catch (error) {
      if (
        error instanceof DomainStateTransitionError ||
        error instanceof TenantBoundaryViolationError
      ) {
        throw error;
      }
      throw mapPgError(error, "competency");
    }
  }

  async transitionState(
    learnerCompetencyId: UUID,
    nextState: LearnerCompetency["state"],
    actorId: UUID,
    verification?: {
      assessmentId: UUID;
      verifiedById: UUID;
    },
  ): Promise<LearnerCompetency> {
    if (actorId !== this.context.claims.subject) {
      throw new DomainStateTransitionError(
        "The transition actor must match the authenticated database context.",
      );
    }

    if (nextState === "VERIFIED_COMPETENCY" && !verification) {
      throw new DomainStateTransitionError(
        "Verified competency requires assessment and verifier linkage.",
      );
    }

    if (nextState !== "VERIFIED_COMPETENCY" && verification) {
      throw new DomainStateTransitionError(
        "Verification linkage is only valid for VERIFIED_COMPETENCY.",
      );
    }

    const verificationInput = verification;

    try {
      const existing = await this.getLearnerCompetency(learnerCompetencyId);

      if (!existing) {
        throw new TenantBoundaryViolationError();
      }

      if (nextState === "VERIFIED_COMPETENCY") {
        const result = await this.context.client.query<LearnerCompetencyRow>(
          `
            UPDATE nabuuma.learner_competencies
            SET
              state = $2,
              assessment_id = $3,
              verified_by_id = $4,
              updated_at = now()
            WHERE id = $1
              AND organisation_id = $5
            RETURNING
              id,
              organisation_id,
              learner_id,
              competency_definition_id,
              state,
              assessment_id,
              verified_by_id,
              verified_at
          `,
          [
            learnerCompetencyId,
            nextState,
            verificationInput!.assessmentId,
            verificationInput!.verifiedById,
            this.context.organisationId,
          ],
        );

        const row = result.rows[0];
        if (!row) throw new TenantBoundaryViolationError();
        return mapLearnerCompetency(row);
      }

      const result = await this.context.client.query<LearnerCompetencyRow>(
        `
          UPDATE nabuuma.learner_competencies
          SET
            state = $2,
            updated_at = now()
          WHERE id = $1
            AND organisation_id = $3
          RETURNING
            id,
            organisation_id,
            learner_id,
            competency_definition_id,
            state,
            assessment_id,
            verified_by_id,
            verified_at
        `,
        [learnerCompetencyId, nextState, this.context.organisationId],
      );

      const row = result.rows[0];
      if (!row) throw new TenantBoundaryViolationError();

      return mapLearnerCompetency(row);
    } catch (error) {
      if (
        error instanceof DomainStateTransitionError ||
        error instanceof TenantBoundaryViolationError
      ) {
        throw error;
      }

      throw mapPgError(error, "competency");
    }
  }
}
