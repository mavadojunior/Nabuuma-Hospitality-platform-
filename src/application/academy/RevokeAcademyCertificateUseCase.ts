import type {
  AcademyCertificateRevocation,
  AcademyRepository,
} from "../../domain/academy";
import type {
  PgExecutionContext,
  PgTransactionManager,
} from "../../infrastructure/database/transaction";
import type {
  TokenClaims,
} from "../../infrastructure/security/security";

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
  ) {}

  async execute(
    input: RevokeAcademyCertificateInput,
    claims: TokenClaims,
  ): Promise<AcademyCertificateRevocation> {
    return this.transactionManager.withTransaction(
      claims,
      async (context) =>
        this.repositoryFactory(context).revokeCertificate(
          input.certificateNumber,
          input.reason,
        ),
    );
  }
}
