import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type {
  AcademyRepository,
} from "../src/domain/academy";
import {
  RevokeAcademyCertificateUseCase,
} from "../src/application/academy";
import type {
  PgExecutionContext,
  PgTransactionManager,
} from "../src/infrastructure/database/transaction";
import type {
  TokenClaims,
} from "../src/infrastructure/security/security";

describe("RevokeAcademyCertificateUseCase", () => {
  const claims = {
    subject: "11111111-1111-1111-1111-111111111111",
    organisationId: "22222222-2222-2222-2222-222222222222",
    roles: ["ASSESSOR"],
  } as unknown as TokenClaims;

  it("revokes through the transaction-scoped repository", async () => {
    // Arrange
    const expected = {
      certificateNumber: "NAB-TEST",
      revokedAt: "2026-10-25T05:00:00.000Z",
      newlyRevoked: true,
    };

    const revokeCertificate = vi.fn(
      async (
        _certificateNumber: string,
        _reason: string,
      ) => expected,
    );

    const repository = {
      revokeCertificate,
    } as unknown as AcademyRepository;

    const context = {} as PgExecutionContext;

    const withTransaction = vi.fn(
      async (
        receivedClaims: TokenClaims,
        work: (
          value: PgExecutionContext,
        ) => Promise<unknown>,
      ) => {
        expect(receivedClaims).toBe(claims);
        return work(context);
      },
    );

    const transactionManager = {
      withTransaction,
    } as unknown as PgTransactionManager;

    const repositoryFactory = vi.fn(
      () => repository,
    );

    const useCase =
      new RevokeAcademyCertificateUseCase(
        transactionManager,
        repositoryFactory,
      );

    // Act
    const result = await useCase.execute(
      {
        certificateNumber: "NAB-TEST",
        reason: "Issued in error",
      },
      claims,
    );

    // Assert
    expect(result).toEqual(expected);
    expect(repositoryFactory).toHaveBeenCalledOnce();
    expect(repositoryFactory).toHaveBeenCalledWith(
      context,
    );
    expect(revokeCertificate).toHaveBeenCalledOnce();
    expect(revokeCertificate).toHaveBeenCalledWith(
      "NAB-TEST",
      "Issued in error",
    );
  });

  it("propagates repository rejection without retrying", async () => {
    // Arrange
    const failure = new Error(
      "revocation rejected",
    );

    const revokeCertificate = vi.fn(
      async (): Promise<never> => {
        throw failure;
      },
    );

    const repository = {
      revokeCertificate,
    } as unknown as AcademyRepository;

    const context = {} as PgExecutionContext;

    const transactionManager = {
      withTransaction: async (
        _claims: TokenClaims,
        work: (
          value: PgExecutionContext,
        ) => Promise<unknown>,
      ) => work(context),
    } as unknown as PgTransactionManager;

    const useCase =
      new RevokeAcademyCertificateUseCase(
        transactionManager,
        () => repository,
      );

    // Act
    const operation = useCase.execute(
      {
        certificateNumber: "NAB-TEST",
        reason: "Issued in error",
      },
      claims,
    );

    // Assert
    await expect(operation).rejects.toBe(failure);
    expect(revokeCertificate).toHaveBeenCalledOnce();
  });
});
