import type {
  AcademyEnrolment,
  AcademyRepository,
} from "../../domain/academy";
import type { UUID } from "../../domain/competency/repositories/contracts";
import type {
  PgAuditRepository,
} from "../../infrastructure/database/repositories/PgAuditRepository";
import type {
  PgExecutionContext,
  PgTransactionManager,
} from "../../infrastructure/database/transaction";
import type { TokenClaims } from "../../infrastructure/security/security";

export class AcademyCourseUnavailableError extends Error {
  constructor() {
    super("The requested Academy course is unavailable.");
    this.name = "AcademyCourseUnavailableError";
  }
}

export class EnrolInAcademyCourseUseCase {
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
    claims: TokenClaims,
  ): Promise<AcademyEnrolment> {
    return this.transactionManager.withTransaction(
      claims,
      async (context) => {
        const repository = this.repositoryFactory(context);
        const course = await repository.getCourseById(courseId);

        if (!course) {
          throw new AcademyCourseUnavailableError();
        }

        const existing = await repository.getEnrolment(courseId);
        if (existing) {
          return existing;
        }

        const enrolment = await repository.enrol(courseId);

        await this.auditRepositoryFactory(context).record({
          organisationId: context.organisationId,
          actorUserId: context.claims.subject,
          action: "ACADEMY.ENROLMENT.CREATE",
          entityType: "ACADEMY_ENROLMENT",
          entityId: enrolment.id,
          outcome: "SUCCESS",
          metadata: {
            courseId: enrolment.courseId,
            learnerId: enrolment.learnerId,
          },
        });

        return enrolment;
      },
    );
  }
}
