import type {
  AcademyLesson,
  AcademyRepository,
} from "../../domain/academy/index.js";
import type { UUID } from "../../domain/competency/repositories/contracts.js";
import type {
  PgExecutionContext,
  PgTransactionManager,
} from "../../infrastructure/database/transaction.js";
import type { TokenClaims } from "../../infrastructure/security/security.js";

export class ListAcademyLessonsUseCase {
  constructor(
    private readonly transactionManager: PgTransactionManager,
    private readonly repositoryFactory: (
      context: PgExecutionContext,
    ) => AcademyRepository,
  ) {}

  async execute(
    courseId: UUID,
    claims: TokenClaims,
  ): Promise<AcademyLesson[]> {
    return this.transactionManager.withTransaction(
      claims,
      async (context) =>
        this.repositoryFactory(context)
          .listPublishedLessons(courseId),
    );
  }
}
