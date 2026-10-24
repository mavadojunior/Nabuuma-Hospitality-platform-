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
