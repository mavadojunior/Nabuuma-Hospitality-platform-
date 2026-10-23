import type {
  AcademyLessonProgress,
  AcademyLessonProgressStatus,
  AcademyRepository,
} from "../../domain/academy";
import type { UUID } from "../../domain/competency/repositories/contracts";
import type {
  PgExecutionContext,
  PgTransactionManager,
} from "../../infrastructure/database/transaction";
import type { TokenClaims } from "../../infrastructure/security/security";

export class InvalidAcademyLessonProgressError extends Error {
  constructor() {
    super("The Academy lesson progress transition is invalid.");
    this.name = "InvalidAcademyLessonProgressError";
  }
}

export interface UpdateAcademyLessonProgressInput {
  readonly courseId: UUID;
  readonly enrolmentId: UUID;
  readonly lessonId: UUID;
  readonly status: AcademyLessonProgressStatus;
  readonly progressPercent: number;
}

function validateProgress(
  status: AcademyLessonProgressStatus,
  progressPercent: number,
): void {
  if (!Number.isInteger(progressPercent)) {
    throw new InvalidAcademyLessonProgressError();
  }

  if (status === "NOT_STARTED" && progressPercent !== 0) {
    throw new InvalidAcademyLessonProgressError();
  }

  if (
    status === "IN_PROGRESS" &&
    (progressPercent < 1 || progressPercent > 99)
  ) {
    throw new InvalidAcademyLessonProgressError();
  }

  if (status === "COMPLETED" && progressPercent !== 100) {
    throw new InvalidAcademyLessonProgressError();
  }
}

export class UpdateAcademyLessonProgressUseCase {
  constructor(
    private readonly transactionManager: PgTransactionManager,
    private readonly repositoryFactory: (
      context: PgExecutionContext,
    ) => AcademyRepository,
  ) {}

  async execute(
    input: UpdateAcademyLessonProgressInput,
    claims: TokenClaims,
  ): Promise<AcademyLessonProgress> {
    validateProgress(input.status, input.progressPercent);

    return this.transactionManager.withTransaction(
      claims,
      async (context) => {
        const repository = this.repositoryFactory(context);

        const existing = await repository.getLessonProgress(
          input.enrolmentId,
          input.lessonId,
        );

        if (
          existing?.status === "COMPLETED" &&
          (
            input.status !== "COMPLETED" ||
            input.progressPercent !== 100
          )
        ) {
          throw new InvalidAcademyLessonProgressError();
        }

        return repository.saveLessonProgress(input);
      },
    );
  }
}
