import type { Pool } from "pg";
import {
  CompleteAcademyCourseUseCase,
  EnrolInAcademyCourseUseCase,
  GetAcademyCertificateUseCase,
  ListAcademyCertificatesUseCase,
  ListAcademyLessonsUseCase,
  ListPublishedAcademyCoursesUseCase,
  RevokeAcademyCertificateUseCase,
  UpdateAcademyLessonProgressUseCase,
} from "./application/academy/index.js";
import { UpdateCompetencyStatusUseCase } from "./application/services/UpdateCompetencyStatusUseCase.js";
import { SubmitEvidenceUseCase } from "./application/services/SubmitEvidenceUseCase.js";
import { CreateAssessmentUseCase } from "./application/services/CreateAssessmentUseCase.js";
import { RecordPracticeSessionUseCase } from "./application/services/RecordPracticeSessionUseCase.js";
import type {
  AssessmentRepository,
  CompetencyRepository,
  EvidenceRepository,
  PracticeSessionRepository,
} from "./domain/competency/repositories/contracts.js";
import { PgAuditRepository } from "./infrastructure/database/repositories/PgAuditRepository.js";
import { PgAcademyRepository } from "./infrastructure/database/repositories/PgAcademyRepository.js";
import { PgTransactionManager } from "./infrastructure/database/transaction.js";

export interface AcademyApplicationServices {
  readonly listPublishedAcademyCoursesUseCase: ListPublishedAcademyCoursesUseCase;
  readonly enrolInAcademyCourseUseCase: EnrolInAcademyCourseUseCase;
  readonly listAcademyLessonsUseCase: ListAcademyLessonsUseCase;
  readonly updateAcademyLessonProgressUseCase: UpdateAcademyLessonProgressUseCase;
  readonly listAcademyCertificatesUseCase: ListAcademyCertificatesUseCase;
  readonly getAcademyCertificateUseCase: GetAcademyCertificateUseCase;
  readonly completeAcademyCourseUseCase: CompleteAcademyCourseUseCase;
  readonly revokeAcademyCertificateUseCase: RevokeAcademyCertificateUseCase;
}

export interface ApplicationServices {
  readonly updateCompetencyStatusUseCase: UpdateCompetencyStatusUseCase;
  readonly submitEvidenceUseCase: SubmitEvidenceUseCase;
  readonly createAssessmentUseCase: CreateAssessmentUseCase;
  readonly recordPracticeSessionUseCase: RecordPracticeSessionUseCase;
}

export interface ApplicationServiceDependencies {
  readonly transactionManager: PgTransactionManager;
  readonly competencyRepository: CompetencyRepository;
  readonly evidenceRepository: EvidenceRepository;
  readonly assessmentRepository: AssessmentRepository;
  readonly practiceSessionRepository: PracticeSessionRepository;
}

export function createTransactionManager(pool: Pool): PgTransactionManager {
  return new PgTransactionManager(pool);
}

export function createApplicationServices(
  dependencies: ApplicationServiceDependencies,
): ApplicationServices {
  const makeAuditRepository = (
    context: ConstructorParameters<typeof PgAuditRepository>[0],
  ): PgAuditRepository => new PgAuditRepository(context);

  return {
    updateCompetencyStatusUseCase: new UpdateCompetencyStatusUseCase(
      dependencies.transactionManager,
      dependencies.competencyRepository,
      makeAuditRepository,
    ),
    submitEvidenceUseCase: new SubmitEvidenceUseCase(
      dependencies.transactionManager,
      dependencies.evidenceRepository,
      makeAuditRepository,
    ),
    createAssessmentUseCase: new CreateAssessmentUseCase(
      dependencies.transactionManager,
      dependencies.assessmentRepository,
      makeAuditRepository,
    ),
    recordPracticeSessionUseCase: new RecordPracticeSessionUseCase(
      dependencies.transactionManager,
      dependencies.practiceSessionRepository,
      makeAuditRepository,
    ),
  };
}


export function createAcademyApplicationServices(
  transactionManager: PgTransactionManager,
): AcademyApplicationServices {
  const makeAcademyRepository = (
    context: ConstructorParameters<typeof PgAcademyRepository>[0],
  ): PgAcademyRepository => new PgAcademyRepository(context);

  const makeAuditRepository = (
    context: ConstructorParameters<typeof PgAuditRepository>[0],
  ): PgAuditRepository => new PgAuditRepository(context);

  return {
    listPublishedAcademyCoursesUseCase:
      new ListPublishedAcademyCoursesUseCase(
        transactionManager,
        makeAcademyRepository,
      ),
    enrolInAcademyCourseUseCase:
      new EnrolInAcademyCourseUseCase(
        transactionManager,
        makeAcademyRepository,
        makeAuditRepository,
      ),
    listAcademyLessonsUseCase:
      new ListAcademyLessonsUseCase(
        transactionManager,
        makeAcademyRepository,
      ),
    updateAcademyLessonProgressUseCase:
      new UpdateAcademyLessonProgressUseCase(
        transactionManager,
        makeAcademyRepository,
        makeAuditRepository,
      ),
    listAcademyCertificatesUseCase:
      new ListAcademyCertificatesUseCase(
        transactionManager,
        makeAcademyRepository,
      ),
    getAcademyCertificateUseCase:
      new GetAcademyCertificateUseCase(
        transactionManager,
        makeAcademyRepository,
      ),
    completeAcademyCourseUseCase:
      new CompleteAcademyCourseUseCase(
        transactionManager,
        makeAcademyRepository,
        makeAuditRepository,
      ),
    revokeAcademyCertificateUseCase:
      new RevokeAcademyCertificateUseCase(
        transactionManager,
        makeAcademyRepository,
        makeAuditRepository,
      ),
  };
}
