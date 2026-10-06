import type {
  Assessment,
  AssessmentRepository,
  UUID,
} from "../../../domain/competency/repositories/contracts";
import { TenantBoundaryViolationError } from "../../../domain/competency/errors";
import type { PgExecutionContext } from "../transaction";
import { mapPgError } from "../error-mapping";

interface AssessmentRow {
  id: string;
  organisation_id: string;
  learner_competency_id: string;
  evidence_id: string;
  assessor_id: string;
  result: Assessment["result"];
  assessment_version: number;
  notes: string | null;
  assessed_at: Date | string;
}

function mapAssessment(row: AssessmentRow): Assessment {
  const notes = row.notes ?? undefined;

  return {
    id: row.id,
    organisationId: row.organisation_id,
    learnerCompetencyId: row.learner_competency_id,
    evidenceId: row.evidence_id,
    assessorId: row.assessor_id,
    result: row.result,
    assessmentVersion: row.assessment_version,
    ...(notes === undefined ? {} : { notes }),
    assessedAt:
      row.assessed_at instanceof Date
        ? row.assessed_at.toISOString()
        : row.assessed_at,
  };
}

export class PgAssessmentRepository implements AssessmentRepository {
  constructor(private readonly context: PgExecutionContext) {}

  async getById(id: UUID): Promise<Assessment | null> {
    try {
      const result = await this.context.client.query<AssessmentRow>(
        `
          SELECT
            id,
            organisation_id,
            learner_competency_id,
            evidence_id,
            assessor_id,
            result,
            assessment_version,
            notes,
            assessed_at
          FROM nabuuma.assessments
          WHERE id = $1
            AND organisation_id = $2
        `,
        [id, this.context.organisationId],
      );

      const row = result.rows[0];
      return row ? mapAssessment(row) : null;
    } catch (error) {
      throw mapPgError(error, "assessment");
    }
  }

  async listForCompetency(
    learnerCompetencyId: UUID,
  ): Promise<Assessment[]> {
    try {
      const result = await this.context.client.query<AssessmentRow>(
        `
          SELECT
            a.id,
            a.organisation_id,
            a.learner_competency_id,
            a.evidence_id,
            a.assessor_id,
            a.result,
            a.assessment_version,
            a.notes,
            a.assessed_at
          FROM nabuuma.assessments a
          WHERE a.learner_competency_id = $1
            AND a.organisation_id = $2
          ORDER BY a.assessed_at DESC, a.id DESC
        `,
        [learnerCompetencyId, this.context.organisationId],
      );

      return result.rows.map(mapAssessment);
    } catch (error) {
      throw mapPgError(error, "assessment");
    }
  }

  async create(
    assessment: Omit<Assessment, "id">,
  ): Promise<Assessment> {
    /*
     * An assessment is always authored by the authenticated actor.
     * This prevents one authenticated Trainer context from attributing
     * an assessment to another Trainer.
     */
    if (assessment.assessorId !== this.context.claims.subject) {
      throw new TenantBoundaryViolationError(
        "The assessor must match the authenticated database context.",
      );
    }

    try {
      /*
       * The INSERT is deliberately constrained by:
       *   1. learner competency tenant,
       *   2. evidence tenant,
       *   3. evidence learner == competency learner,
       *   4. database-level assessor authorization.
       *
       * This creates the Trainer -> learner progress linkage at the
       * persistence boundary instead of trusting application input alone.
       */
      const result = await this.context.client.query<AssessmentRow>(
        `
          INSERT INTO nabuuma.assessments (
            organisation_id,
            learner_competency_id,
            evidence_id,
            assessor_id,
            result,
            assessment_version,
            notes,
            assessed_at
          )
          SELECT
            lc.organisation_id,
            lc.id,
            e.id,
            $3,
            $4,
            $5,
            $6,
            $7
          FROM nabuuma.learner_competencies lc
          JOIN nabuuma.evidence_records e
            ON e.id = $2
           AND e.organisation_id = lc.organisation_id
           AND e.learner_id = lc.learner_id
          WHERE lc.id = $1
            AND lc.organisation_id = $8
            AND nabuuma.is_authorized_assessor(
              lc.organisation_id,
              $3
            )
          RETURNING
            id,
            organisation_id,
            learner_competency_id,
            evidence_id,
            assessor_id,
            result,
            assessment_version,
            notes,
            assessed_at
        `,
        [
          assessment.learnerCompetencyId,
          assessment.evidenceId,
          assessment.assessorId,
          assessment.result,
          assessment.assessmentVersion,
          assessment.notes ?? null,
          assessment.assessedAt,
          this.context.organisationId,
        ],
      );

      const row = result.rows[0];

      if (!row) {
        throw new TenantBoundaryViolationError(
          "The assessment target, evidence, or assessor is outside the authorized tenant/progress boundary.",
        );
      }

      return mapAssessment(row);
    } catch (error) {
      if (error instanceof TenantBoundaryViolationError) throw error;
      throw mapPgError(error, "assessment");
    }
  }
}
