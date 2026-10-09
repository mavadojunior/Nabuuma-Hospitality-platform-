import type {
  EvidenceRecord,
  EvidenceRepository,
  UUID,
} from "../../domain/competency/repositories/contracts";
import type { PgExecutionContext, PgTransactionManager } from "../../infrastructure/database/transaction";
import type { PgAuditRepository } from "../../infrastructure/database/repositories/PgAuditRepository";

export interface SubmitEvidenceInput {
  learnerId: UUID;
  evidenceUrl: string;
  checksum: string;
  title: string;
  methodSummary?: string;
  reflection?: string;
  practiceSessionId: UUID;
}

export interface SubmitEvidenceContext {
  claims: {
    subject: UUID;
    organisationId: UUID;
    correlationId?: UUID;
  };
}

export class SubmitEvidenceUseCase {
  constructor(
    private readonly transactionManager: PgTransactionManager,
    private readonly evidenceRepository: EvidenceRepository,
    private readonly auditRepositoryFactory: (
      context: PgExecutionContext,
    ) => PgAuditRepository,
  ) {}

  async execute(
    input: SubmitEvidenceInput,
    context: SubmitEvidenceContext,
  ): Promise<EvidenceRecord> {
    return this.transactionManager.withTransaction(
      context.claims as any,
      async (txContext: PgExecutionContext) => {
        const evidence = await this.evidenceRepository.create({
          organisationId: txContext.organisationId,
          learnerId: input.learnerId,
          practiceSessionId: input.practiceSessionId,
          title: input.title,
          status: "SUBMITTED",
          methodSummary: input.methodSummary,
          reflection: input.reflection,
          artifactUri: input.evidenceUrl,
          metadata: {
            checksum: input.checksum,
            evidenceUrl: input.evidenceUrl,
          },
          submittedAt: new Date().toISOString(),
        });

        const auditRepository = this.auditRepositoryFactory(txContext);

        await auditRepository.record({
          organisationId: txContext.organisationId,
          actorUserId: txContext.claims.subject,
          action: "EVIDENCE.SUBMIT",
          entityType: "EVIDENCE_RECORD",
          entityId: evidence.id,
          correlationId: context.claims.correlationId ?? null,
          outcome: "SUCCESS",
          metadata: {
            evidenceUrl: input.evidenceUrl,
            checksum: input.checksum,
            learnerId: input.learnerId,
          },
        });

        return evidence;
      },
    );
  }
}
