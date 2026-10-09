import type {
  PracticeSession,
  PracticeSessionRepository,
  UUID,
} from "../../domain/competency/repositories/contracts";
import type { PgExecutionContext, PgTransactionManager } from "../../infrastructure/database/transaction";
import type { PgAuditRepository } from "../../infrastructure/database/repositories/PgAuditRepository";

export interface RecordPracticeSessionInput {
  learnerId: UUID;
  competencyId: UUID;
  durationMs: number;
  brief?: Record<string, unknown>;
  context?: Record<string, unknown>;
}

export interface RecordPracticeSessionContext {
  claims: {
    subject: UUID;
    organisationId: UUID;
    correlationId?: UUID;
  };
}

export class RecordPracticeSessionUseCase {
  constructor(
    private readonly transactionManager: PgTransactionManager,
    private readonly practiceSessionRepository: PracticeSessionRepository,
    private readonly auditRepositoryFactory: (
      context: PgExecutionContext,
    ) => PgAuditRepository,
  ) {}

  async execute(
    input: RecordPracticeSessionInput,
    context: RecordPracticeSessionContext,
  ): Promise<PracticeSession> {
    return this.transactionManager.withTransaction(
      context.claims as any,
      async (txContext: PgExecutionContext) => {
        const session = await this.practiceSessionRepository.create({
          organisationId: txContext.organisationId,
          learnerId: input.learnerId,
          competencyId: input.competencyId,
          status: "IN_PROGRESS",
          brief: input.brief ?? {},
          context: {
            ...(input.context ?? {}),
            durationMs: input.durationMs,
          },
        });

        const auditRepository = this.auditRepositoryFactory(txContext);

        await auditRepository.record({
          organisationId: txContext.organisationId,
          actorUserId: txContext.claims.subject,
          action: "PRACTICE_SESSION.RECORD",
          entityType: "PRACTICE_SESSION",
          entityId: session.id,
          correlationId: context.claims.correlationId ?? null,
          outcome: "SUCCESS",
          metadata: {
            durationMs: input.durationMs,
            competencyId: input.competencyId,
            learnerId: input.learnerId,
          },
        });

        return session;
      },
    );
  }
}
