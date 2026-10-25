import type {
  AcademyCertificate,
  AcademyRepository,
} from "../../domain/academy";
import type {
  UUID,
} from "../../domain/competency/repositories/contracts";
import type {
  PgAuditRepository,
} from "../../infrastructure/database/repositories/PgAuditRepository";
import type {
  PgExecutionContext,
  PgTransactionManager,
} from "../../infrastructure/database/transaction";
import type {
  TokenClaims,
} from "../../infrastructure/security/security";

export class CompleteAcademyCourseUseCase {
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
    courseId: UUID,
    enrolmentId: UUID,
    claims: TokenClaims,
  ): Promise<AcademyCertificate> {
    return this.transactionManager.withTransaction(
      claims,
      async (context) => {
        const certificate =
          await this.repositoryFactory(context)
            .completeCourse(
              courseId,
              enrolmentId,
            );

        await this.auditRepositoryFactory(context).record({
          organisationId: context.organisationId,
          actorUserId: context.claims.subject,
          action: "CERTIFICATE.ISSUE",
          entityType: "ACADEMY_CERTIFICATE",
          entityId: certificate.id,
          outcome: "SUCCESS",
          metadata: {
            certificateNumber:
              certificate.certificateNumber,
            courseId:
              certificate.courseId,
            enrolmentId:
              certificate.enrolmentId,
          },
        });

        return certificate;
      },
    );
  }
}
