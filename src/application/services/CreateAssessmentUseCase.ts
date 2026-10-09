import type {
  Assessment,
  AssessmentRepository,
  UUID,
} from "../../domain/competency/repositories/contracts";
import type { PgExecutionContext, PgTransactionManager } from "../../infrastructure/database/transaction";
import type { PgAuditRepository } from "../../infrastructure/database/repositories/PgAuditRepository";

export interface CreateAssessmentInput {
  learnerCompetencyId: UUID;
  evidenceId: UUID;
  result: Assessment["result"];
  notes?: string;
}

export interface CreateAssessmentContext {
  claims: {
    subject: UUID;
    organisationId: UUID;
    correlationId?: UUID;
  };
}

export class CreateAssessmentUseCase {
  constructor(
    private readonly transactionManager: PgTransactionManager,
    private readonly assessmentRepository: AssessmentRepository,
    private readonly auditRepositoryFactory: (
      context: PgExecutionContext,
    ) => PgAuditRepository,
  ) {}

  async execute(
    input: CreateAssessmentInput,
    context: CreateAssessmentContext,
  ): Promise<Assessment> {
    return this.transactionManager.withTransaction(
      context.claims as any,
      async (txContext: PgExecutionContext) => {
        const assessment = await this.assessmentRepository.create({
          organisationId: txContext.organisationId,
          learnerCompetencyId: input.learnerCompetencyId,
          evidenceId: input.evidenceId,
          assessorId: txContext.claims.subject,
          result: input.result,
          assessmentVersion: 1,
          notes: input.notes,
          assessedAt: new Date().toISOString(),
        });

        const auditRepository = this.auditRepositoryFactory(txContext);

        await auditRepository.record({
          organisationId: txContext.organisationId,
          actorUserId: txContext.claims.subject,
          action: "ASSESSMENT.CREATE",
          entityType: "ASSESSMENT",
          entityId: assessment.id,
          correlationId: context.claims.correlationId ?? null,
          outcome: "SUCCESS",
          metadata: {
            result: input.result,
            learnerCompetencyId: input.learnerCompetencyId,
            evidenceId: input.evidenceId,
          },
        });

        return assessment;
      },
    );
  }
}
