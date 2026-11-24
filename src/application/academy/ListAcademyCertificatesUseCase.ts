import type {
  AcademyCertificate,
  AcademyRepository,
} from "../../domain/academy/index.js";
import type {
  PgExecutionContext,
  PgTransactionManager,
} from "../../infrastructure/database/transaction.js";
import type { TokenClaims } from "../../infrastructure/security/security.js";

export class ListAcademyCertificatesUseCase {
  constructor(
    private readonly transactionManager: PgTransactionManager,
    private readonly repositoryFactory: (
      context: PgExecutionContext,
    ) => AcademyRepository,
  ) {}

  async execute(
    claims: TokenClaims,
  ): Promise<AcademyCertificate[]> {
    return this.transactionManager.withTransaction(
      claims,
      async (context) =>
        this.repositoryFactory(context).listCertificates(),
    );
  }
}
