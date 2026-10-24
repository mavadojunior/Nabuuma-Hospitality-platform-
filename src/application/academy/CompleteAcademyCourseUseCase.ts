import type {
  AcademyCertificate,
  AcademyRepository,
} from "../../domain/academy";
import type { UUID } from "../../domain/competency/repositories/contracts";
import type {
  PgExecutionContext,
  PgTransactionManager,
} from "../../infrastructure/database/transaction";
import type { TokenClaims } from "../../infrastructure/security/security";

export class CompleteAcademyCourseUseCase {
  constructor(
    private readonly transactionManager: PgTransactionManager,
    private readonly repositoryFactory: (
      context: PgExecutionContext,
    ) => AcademyRepository,
  ) {}

  async execute(
    courseId: UUID,
    enrolmentId: UUID,
    claims: TokenClaims,
  ): Promise<AcademyCertificate> {
    return this.transactionManager.withTransaction(
      claims,
      async (context) =>
        this.repositoryFactory(context).completeCourse(
          courseId,
          enrolmentId,
        ),
    );
  }
}
