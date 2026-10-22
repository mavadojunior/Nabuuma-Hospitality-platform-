import type {
  AcademyCourse,
  AcademyRepository,
} from "../../domain/academy";
import type {
  PgExecutionContext,
  PgTransactionManager,
} from "../../infrastructure/database/transaction";
import type { TokenClaims } from "../../infrastructure/security/security";

export class ListPublishedAcademyCoursesUseCase {
  constructor(
    private readonly transactionManager: PgTransactionManager,
    private readonly repositoryFactory: (
      context: PgExecutionContext,
    ) => AcademyRepository,
  ) {}

  async execute(claims: TokenClaims): Promise<AcademyCourse[]> {
    return this.transactionManager.withTransaction(
      claims,
      async (context) =>
        this.repositoryFactory(context).listPublishedCourses(),
    );
  }
}
