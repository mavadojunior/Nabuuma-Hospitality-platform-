import type { Pool } from "pg";
import {
  CompleteAcademyCourseUseCase,
  EnrolInAcademyCourseUseCase,
  GetAcademyCertificateUseCase,
  ListAcademyCertificatesUseCase,
  ListAcademyLessonsUseCase,
  ListPublishedAcademyCoursesUseCase,
  UpdateAcademyLessonProgressUseCase,
} from "./application/academy";
import { UpdateCompetencyStatusUseCase } from "./application/services/UpdateCompetencyStatusUseCase";
import { SubmitEvidenceUseCase } from "./application/services/SubmitEvidenceUseCase";
import { CreateAssessmentUseCase } from "./application/services/CreateAssessmentUseCase";
import { RecordPracticeSessionUseCase } from "./application/services/RecordPracticeSessionUseCase";
import type {
  AssessmentRepository,
  CompetencyRepository,
  EvidenceRepository,
  PracticeSessionRepository,
} from "./domain/competency/repositories/contracts";
import { PgAuditRepository } from "./infrastructure/database/repositories/PgAuditRepository";
import { PgAcademyRepository } from "./infrastructure/database/repositories/PgAcademyRepository";
import { PgTransactionManager } from "./infrastructure/database/transaction";

export interface AcademyApplicationServices {
  readonly listPublishedAcademyCoursesUseCase: ListPublishedAcademyCoursesUseCase;
  readonly enrolInAcademyCourseUseCase: EnrolInAcademyCourseUseCase;
  readonly listAcademyLessonsUseCase: ListAcademyLessonsUseCase;
  readonly updateAcademyLessonProgressUseCase: UpdateAcademyLessonProgressUseCase;
  readonly listAcademyCertificatesUseCase: ListAcademyCertificatesUseCase;
  readonly getAcademyCertificateUseCase: GetAcademyCertificateUseCase;
  readonly completeAcademyCourseUseCase: CompleteAcademyCourseUseCase;
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
      ),
  };
}
