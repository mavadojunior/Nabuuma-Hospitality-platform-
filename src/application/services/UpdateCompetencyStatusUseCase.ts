import type {
  CompetencyRepository,
  LearnerCompetency,
  UUID,
} from "../../domain/competency/repositories/contracts";
import type { PgExecutionContext, PgTransactionManager } from "../../infrastructure/database/transaction";
import type { PgAuditRepository } from "../../infrastructure/database/repositories/PgAuditRepository";

export interface UpdateCompetencyStatusInput {
  learnerCompetencyId: UUID;
  nextState: LearnerCompetency["state"];
  competencyDefinitionId: UUID;
}

export interface UpdateCompetencyStatusContext {
  claims: {
    subject: UUID;
    organisationId: UUID;
    correlationId?: UUID;
  };
}

export class UpdateCompetencyStatusUseCase {
  constructor(
    private readonly transactionManager: PgTransactionManager,
    private readonly competencyRepository: CompetencyRepository,
    private readonly auditRepositoryFactory: (
      context: PgExecutionContext,
    ) => PgAuditRepository,
  ) {}

  async execute(
    input: UpdateCompetencyStatusInput,
    context: UpdateCompetencyStatusContext,
  ): Promise<LearnerCompetency> {
    return this.transactionManager.withTransaction(
      context.claims as any,
      async (txContext: PgExecutionContext) => {
        const current = await this.competencyRepository.getLearnerCompetency(
          input.learnerCompetencyId,
        );

        if (!current) {
          throw new Error(
            `Learner competency ${input.learnerCompetencyId} not found.`,
          );
        }

        const next = await this.competencyRepository.transitionState(
          input.learnerCompetencyId,
          input.nextState,
          txContext.claims.subject,
        );

        const auditRepository = this.auditRepositoryFactory(txContext);

        await auditRepository.record({
          organisationId: txContext.organisationId,
          actorUserId: txContext.claims.subject,
          action: "COMPETENCY.TRANSITION",
          entityType: "LEARNER_COMPETENCY",
          entityId: next.id,
          correlationId: context.claims.correlationId ?? null,
          outcome: "SUCCESS",
          metadata: {
            previousStatus: current.state,
            nextStatus: input.nextState,
            competencyDefinitionId: input.competencyDefinitionId,
          },
        });

        return next;
      },
    );
  }
}
