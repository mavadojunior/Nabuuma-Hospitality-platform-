import type {
  AcademyLessonProgress,
  AcademyLessonProgressStatus,
  AcademyRepository,
} from "../../domain/academy";
import type { UUID } from "../../domain/competency/repositories/contracts";
import type {
  PgAuditRepository,
} from "../../infrastructure/database/repositories/PgAuditRepository";
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
    private readonly auditRepositoryFactory: (
      context: PgExecutionContext,
    ) => PgAuditRepository,
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

        const progress =
          await repository.saveLessonProgress(input);

        await this.auditRepositoryFactory(context).record({
          organisationId: context.organisationId,
          actorUserId: context.claims.subject,
          action: "ACADEMY.LESSON_PROGRESS.UPDATE",
          entityType: "ACADEMY_LESSON_PROGRESS",
          entityId: progress.id,
          outcome: "SUCCESS",
          metadata: {
            courseId: progress.courseId,
            enrolmentId: progress.enrolmentId,
            lessonId: progress.lessonId,
            status: progress.status,
            progressPercent: progress.progressPercent,
          },
        });

        return progress;
      },
    );
  }
}
