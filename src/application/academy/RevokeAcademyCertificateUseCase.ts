import type {
  AcademyCertificateRevocation,
  AcademyRepository,
} from "../../domain/academy/index.js";
import type {
  PgAuditRepository,
} from "../../infrastructure/database/repositories/PgAuditRepository.js";
import type {
  PgExecutionContext,
  PgTransactionManager,
} from "../../infrastructure/database/transaction.js";
import type {
  TokenClaims,
} from "../../infrastructure/security/security.js";

export interface RevokeAcademyCertificateInput {
  readonly certificateNumber: string;
  readonly reason: string;
}

export class RevokeAcademyCertificateUseCase {
  constructor(
    private readonly transactionManager: PgTransactionManager,
    private readonly repositoryFactory: (
      context: PgExecutionContext,
    ) => AcademyRepository,
    private readonly auditRepositoryFactory: (
      context: PgExecutionContext,
    ) => PgAuditRepository,
  ) {}

  async execute(
    input: RevokeAcademyCertificateInput,
    claims: TokenClaims,
  ): Promise<AcademyCertificateRevocation> {
    return this.transactionManager.withTransaction(
      claims,
      async (context) => {
        const revocation =
          await this.repositoryFactory(context)
            .revokeCertificate(
              input.certificateNumber,
              input.reason,
            );

        await this.auditRepositoryFactory(context).record({
          organisationId: context.organisationId,
          actorUserId: context.claims.subject,
          action: "CERTIFICATE.REVOKE",
          entityType: "ACADEMY_CERTIFICATE",
          outcome: "SUCCESS",
          metadata: {
            certificateNumber:
              revocation.certificateNumber,
            newlyRevoked:
              revocation.newlyRevoked,
          },
        });

        return revocation;
      },
    );
  }
}
