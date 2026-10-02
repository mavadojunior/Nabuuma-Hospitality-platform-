/**
 * Framework-agnostic persistence contracts for the Nabuuma competency slice.
 *
 * These interfaces intentionally do not import PostgreSQL, an ORM, HTTP,
 * or application-framework types. Infrastructure adapters implement them.
 */

export type UUID = string;

export type CompetencyState =
  | "EXPOSURE"
  | "PRACTICE"
  | "DEMONSTRATION"
  | "VERIFIED_COMPETENCY";

export type TelemetryQualityStatus =
  | "UNVERIFIED"
  | "VALID"
  | "QUESTIONABLE"
  | "INVALID"
  | "EXCLUDED";

export type TelemetryValueType =
  | "DECIMAL"
  | "INTEGER"
  | "DURATION_MS"
  | "RATIO"
  | "PERCENTAGE"
  | "CATEGORICAL"
  | "BOOLEAN"
  | "SCORE"
  | "RANGE";

export interface TelemetryContext {
  [key: string]: string | number | boolean | null | string[] | number[];
}

export interface TelemetryObservation {
  id: UUID;
  organisationId: UUID;
  practiceSessionId: UUID;
  telemetryDefinitionId: UUID;
  observedById: UUID;
  instrumentId?: UUID;
  observedAt: string;

  /** Exactly one value member is populated by the persistence adapter. */
  value:
    | { type: "DECIMAL"; value: number }
    | { type: "INTEGER"; value: number }
    | { type: "DURATION_MS"; value: number }
    | { type: "RATIO"; value: number }
    | { type: "PERCENTAGE"; value: number }
    | { type: "CATEGORICAL"; value: string }
    | { type: "BOOLEAN"; value: boolean }
    | { type: "SCORE"; value: number }
    | { type: "RANGE"; value: { min?: number; max?: number } };

  unit?: string;
  method?: string;
  qualityStatus: TelemetryQualityStatus;
  context: TelemetryContext;
}

export interface TelemetryDefinition {
  id: UUID;
  stableKey: string;
  version: number;
  name: string;
  valueType: TelemetryValueType;
  canonicalUnit?: string;
  method?: string;
  precisionScale?: number;
  minValue?: number;
  maxValue?: number;
  referenceStandard?: string;
}

export interface KnowledgeNode {
  id: UUID;
  organisationId?: UUID;
  parentId?: UUID;
  nodeType: "DOMAIN" | "SKILL" | "CONCEPT";
  stableKey: string;
  version: number;
  name: string;
  description?: string;
  scope: "PLATFORM" | "ORGANISATION";
  authoritative: boolean;
}

export interface CompetencyDefinition {
  id: UUID;
  organisationId?: UUID;
  stableKey: string;
  version: number;
  name: string;
  description: string;
  requiredKnowledgeNodeIds: UUID[];
}

export interface LearnerCompetency {
  id: UUID;
  organisationId: UUID;
  learnerId: UUID;
  competencyDefinitionId: UUID;
  state: CompetencyState;
  assessmentId?: UUID;
  verifiedById?: UUID;
  verifiedAt?: string;
}

export interface PracticeSession {
  id: UUID;
  organisationId: UUID;
  learnerId: UUID;
  competencyId: UUID;
  status:
    | "PLANNED"
    | "IN_PROGRESS"
    | "SUBMITTED"
    | "UNDER_REVIEW"
    | "COMPLETED"
    | "CANCELLED";
  startedAt?: string;
  completedAt?: string;
  brief: Record<string, unknown>;
  context: Record<string, unknown>;
}

export interface EvidenceRecord {
  id: UUID;
  organisationId: UUID;
  learnerId: UUID;
  practiceSessionId: UUID;
  title: string;
  status:
    | "DRAFT"
    | "SUBMITTED"
    | "UNDER_REVIEW"
    | "ACCEPTED"
    | "REJECTED"
    | "SUPERSEDED";
  methodSummary?: string;
  reflection?: string;
  artifactUri?: string;
  metadata: Record<string, unknown>;
  submittedAt?: string;
}

export interface Assessment {
  id: UUID;
  organisationId: UUID;
  learnerCompetencyId: UUID;
  evidenceId: UUID;
  assessorId: UUID;
  result:
    | "INCOMPLETE"
    | "REQUIRES_REASSESSMENT"
    | "DEMONSTRATED"
    | "VERIFIED";
  assessmentVersion: number;
  notes?: string;
  assessedAt: string;
}

export interface KnowledgeNodeRepository {
  getById(id: UUID): Promise<KnowledgeNode | null>;
  listChildren(parentId: UUID): Promise<KnowledgeNode[]>;
  listByType(
    nodeType: KnowledgeNode["nodeType"],
    organisationId?: UUID,
  ): Promise<KnowledgeNode[]>;
}

export interface CompetencyRepository {
  getDefinition(id: UUID): Promise<CompetencyDefinition | null>;
  getLearnerCompetency(id: UUID): Promise<LearnerCompetency | null>;
  createLearnerCompetency(
    competency: Omit<LearnerCompetency, "id">,
  ): Promise<LearnerCompetency>;

  /**
   * Persistence implementation must execute this operation transactionally.
   * VERIFIED_COMPETENCY is never accepted without assessmentId + verifiedById;
   * PostgreSQL remains the final enforcement boundary.
   */
  transitionState(
    learnerCompetencyId: UUID,
    nextState: CompetencyState,
    actorId: UUID,
    verification?: {
      assessmentId: UUID;
      verifiedById: UUID;
    },
  ): Promise<LearnerCompetency>;
}

export interface PracticeSessionRepository {
  getById(id: UUID): Promise<PracticeSession | null>;
  listForCompetency(competencyId: UUID): Promise<PracticeSession[]>;
  create(
    session: Omit<PracticeSession, "id">,
  ): Promise<PracticeSession>;
  updateStatus(
    id: UUID,
    status: PracticeSession["status"],
  ): Promise<PracticeSession>;
}

export interface TelemetryRepository {
  getDefinition(id: UUID): Promise<TelemetryDefinition | null>;
  record(
    observation: Omit<TelemetryObservation, "id">,
  ): Promise<TelemetryObservation>;
  listForPracticeSession(
    practiceSessionId: UUID,
  ): Promise<TelemetryObservation[]>;
  findNumericRange(
    telemetryDefinitionId: UUID,
    min: number,
    max: number,
  ): Promise<TelemetryObservation[]>;
}

export interface EvidenceRepository {
  getById(id: UUID): Promise<EvidenceRecord | null>;
  listForLearner(learnerId: UUID): Promise<EvidenceRecord[]>;
  create(
    evidence: Omit<EvidenceRecord, "id">,
  ): Promise<EvidenceRecord>;
}

export interface AssessmentRepository {
  getById(id: UUID): Promise<Assessment | null>;
  listForCompetency(
    learnerCompetencyId: UUID,
  ): Promise<Assessment[]>;
  create(
    assessment: Omit<Assessment, "id">,
  ): Promise<Assessment>;
}
