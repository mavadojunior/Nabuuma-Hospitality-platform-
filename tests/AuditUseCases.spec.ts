import { describe, expect, it, vi } from "vitest";
import type {
  Assessment,
  EvidenceRecord,
  LearnerCompetency,
  PracticeSession,
  UUID,
} from "../src/domain/competency/repositories/contracts";
import { CreateAssessmentUseCase } from "../src/application/services/CreateAssessmentUseCase";
import { RecordPracticeSessionUseCase } from "../src/application/services/RecordPracticeSessionUseCase";
import { SubmitEvidenceUseCase } from "../src/application/services/SubmitEvidenceUseCase";
import { UpdateCompetencyStatusUseCase } from "../src/application/services/UpdateCompetencyStatusUseCase";
import { createApplicationServices } from "../src/bootstrap";
import type { PgExecutionContext } from "../src/infrastructure/database/transaction";

const orgId = "org-456" as UUID;
const actorId = "user-123" as UUID;
const correlationId = "corr-789" as UUID;

function makeTxContext(): PgExecutionContext {
  return {
    client: {} as any,
    security: {
      claims: {
        subject: actorId,
        organisationId: orgId,
        roles: ["TRAINER"],
      },
      requestId: "req-1",
    },
    claims: {
      subject: actorId,
      organisationId: orgId,
      roles: ["TRAINER"],
      correlationId,
    },
    organisationId: orgId,
  };
}

describe("audit-wired use cases", () => {
  it("writes competency transition audit metadata inside the same transaction", async () => {
    const transitionRepo = {
      getLearnerCompetency: vi.fn(async () => ({
        id: "lc-1",
        organisationId: orgId,
        learnerId: "learner-1",
        competencyDefinitionId: "cd-1",
        state: "PRACTICE",
      } as LearnerCompetency)),
      transitionState: vi.fn(async () => ({
        id: "lc-1",
        organisationId: orgId,
        learnerId: "learner-1",
        competencyDefinitionId: "cd-1",
        state: "DEMONSTRATION",
      } as LearnerCompetency)),
    } as any;

    const auditRecord = vi.fn(async () => ({ id: "audit-1" }));
    const transactionManager = {
      withTransaction: vi.fn(async (_security: unknown, work: (ctx: PgExecutionContext) => Promise<any>) =>
        work(makeTxContext())),
    } as any;

    const useCase = new UpdateCompetencyStatusUseCase(
      transactionManager,
      transitionRepo,
      () => ({ record: auditRecord }) as any,
    );

    await useCase.execute(
      { learnerCompetencyId: "lc-1", nextState: "DEMONSTRATION", competencyDefinitionId: "cd-1" },
      { claims: { subject: actorId, organisationId: orgId, correlationId } },
    );

    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        organisationId: orgId,
        actorUserId: actorId,
        action: "COMPETENCY.TRANSITION",
        entityType: "LEARNER_COMPETENCY",
        correlationId,
        metadata: {
          previousStatus: "PRACTICE",
          nextStatus: "DEMONSTRATION",
          competencyDefinitionId: "cd-1",
        },
      }),
    );
  });

  it("writes evidence submission audit metadata inside the same transaction", async () => {
    const evidenceRepo = {
      create: vi.fn(async () => ({
        id: "evidence-1",
        organisationId: orgId,
        learnerId: "learner-1",
        practiceSessionId: "practice-1",
        title: "Evidence",
        status: "SUBMITTED",
        metadata: {},
      } as EvidenceRecord)),
    } as any;

    const auditRecord = vi.fn(async () => ({ id: "audit-2" }));
    const transactionManager = {
      withTransaction: vi.fn(async (_security: unknown, work: (ctx: PgExecutionContext) => Promise<any>) =>
        work(makeTxContext())),
    } as any;

    const useCase = new SubmitEvidenceUseCase(
      transactionManager,
      evidenceRepo,
      () => ({ record: auditRecord }) as any,
    );

    await useCase.execute(
      {
        learnerId: "learner-1",
        evidenceUrl: "https://example.com/evidence",
        checksum: "abc123",
        title: "Evidence",
        practiceSessionId: "practice-1",
      },
      { claims: { subject: actorId, organisationId: orgId, correlationId } },
    );

    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        organisationId: orgId,
        actorUserId: actorId,
        action: "EVIDENCE.SUBMIT",
        entityType: "EVIDENCE_RECORD",
        correlationId,
        metadata: {
          evidenceUrl: "https://example.com/evidence",
          checksum: "abc123",
          learnerId: "learner-1",
        },
      }),
    );
  });

  it("writes assessment creation audit metadata inside the same transaction", async () => {
    const assessmentRepo = {
      create: vi.fn(async () => ({
        id: "assessment-1",
        organisationId: orgId,
        learnerCompetencyId: "lc-1",
        evidenceId: "evidence-1",
        assessorId: actorId,
        result: "VERIFIED",
        assessmentVersion: 1,
        assessedAt: "2026-01-01T00:00:00.000Z",
      } as Assessment)),
    } as any;

    const auditRecord = vi.fn(async () => ({ id: "audit-3" }));
    const transactionManager = {
      withTransaction: vi.fn(async (_security: unknown, work: (ctx: PgExecutionContext) => Promise<any>) =>
        work(makeTxContext())),
    } as any;

    const useCase = new CreateAssessmentUseCase(
      transactionManager,
      assessmentRepo,
      () => ({ record: auditRecord }) as any,
    );

    await useCase.execute(
      {
        learnerCompetencyId: "lc-1",
        evidenceId: "evidence-1",
        result: "VERIFIED",
      },
      { claims: { subject: actorId, organisationId: orgId, correlationId } },
    );

    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        organisationId: orgId,
        actorUserId: actorId,
        action: "ASSESSMENT.CREATE",
        entityType: "ASSESSMENT",
        correlationId,
        metadata: {
          result: "VERIFIED",
          learnerCompetencyId: "lc-1",
          evidenceId: "evidence-1",
        },
      }),
    );
  });

  it("writes practice session audit metadata inside the same transaction", async () => {
    const practiceRepo = {
      create: vi.fn(async () => ({
        id: "session-1",
        organisationId: orgId,
        learnerId: "learner-1",
        competencyId: "cd-1",
        status: "IN_PROGRESS",
        brief: {},
        context: { durationMs: 120000 },
      } as PracticeSession)),
    } as any;

    const auditRecord = vi.fn(async () => ({ id: "audit-4" }));
    const transactionManager = {
      withTransaction: vi.fn(async (_security: unknown, work: (ctx: PgExecutionContext) => Promise<any>) =>
        work(makeTxContext())),
    } as any;

    const useCase = new RecordPracticeSessionUseCase(
      transactionManager,
      practiceRepo,
      () => ({ record: auditRecord }) as any,
    );

    await useCase.execute(
      {
        learnerId: "learner-1",
        competencyId: "cd-1",
        durationMs: 120000,
      },
      { claims: { subject: actorId, organisationId: orgId, correlationId } },
    );

    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        organisationId: orgId,
        actorUserId: actorId,
        action: "PRACTICE_SESSION.RECORD",
        entityType: "PRACTICE_SESSION",
        correlationId,
        metadata: {
          durationMs: 120000,
          competencyId: "cd-1",
          learnerId: "learner-1",
        },
      }),
    );
  });

  it("creates the app services wiring surface", () => {
    const services = createApplicationServices({
      transactionManager: {} as any,
      competencyRepository: {} as any,
      evidenceRepository: {} as any,
      assessmentRepository: {} as any,
      practiceSessionRepository: {} as any,
    });

    expect(services).toHaveProperty("updateCompetencyStatusUseCase");
    expect(services).toHaveProperty("submitEvidenceUseCase");
    expect(services).toHaveProperty("createAssessmentUseCase");
    expect(services).toHaveProperty("recordPracticeSessionUseCase");
  });
});
