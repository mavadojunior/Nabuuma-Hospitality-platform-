import type {
  AcademyEnrolment,
  AcademyRepository,
} from "../../domain/academy";
import type { UUID } from "../../domain/competency/repositories/contracts";
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

        return repository.enrol(courseId);
      },
    );
  }
}
