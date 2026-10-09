import type { Pool } from "pg";
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
import { PgTransactionManager } from "./infrastructure/database/transaction";

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
  const makeAuditRepository = (context: Parameters<typeof PgAuditRepository>[0]) =>
    new PgAuditRepository(context);

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
