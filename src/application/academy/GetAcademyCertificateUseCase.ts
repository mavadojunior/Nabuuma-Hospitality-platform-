import type {
  AcademyCertificate,
  AcademyRepository,
} from "../../domain/academy/index.js";
import type { UUID } from "../../domain/competency/repositories/contracts.js";
import type {
  PgExecutionContext,
  PgTransactionManager,
} from "../../infrastructure/database/transaction.js";
import type { TokenClaims } from "../../infrastructure/security/security.js";

export class AcademyCertificateNotFoundError extends Error {
  constructor() {
    super("The requested Academy certificate was not found.");
    this.name = "AcademyCertificateNotFoundError";
  }
}

export class GetAcademyCertificateUseCase {
  constructor(
    private readonly transactionManager: PgTransactionManager,
    private readonly repositoryFactory: (
      context: PgExecutionContext,
    ) => AcademyRepository,
  ) {}

  async execute(
    certificateId: UUID,
    claims: TokenClaims,
  ): Promise<AcademyCertificate> {
    return this.transactionManager.withTransaction(
      claims,
      async (context) => {
        const certificate =
          await this.repositoryFactory(context)
            .getCertificateById(certificateId);

        if (!certificate) {
          throw new AcademyCertificateNotFoundError();
        }

        return certificate;
      },
    );
  }
}
