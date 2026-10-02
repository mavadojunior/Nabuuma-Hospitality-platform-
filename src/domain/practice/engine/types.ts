import type { TokenClaims } from "../../../infrastructure/security/security";
import type { TelemetryPayload, TelemetryRule } from "../../measurement/validation/types";

export type DomainVertical = "COFFEE" | "MIXOLOGY" | "OPERATIONS";
export type ScenarioDifficulty = "FOUNDATION" | "INTERMEDIATE" | "ADVANCED" | "EXPERT";
export type ScenarioSessionStatus = "READY" | "ACTIVE" | "COMPLETED" | "FAILED" | "CANCELLED";

export interface ScenarioState {
  readonly values: Readonly<Record<string, unknown>>;
  readonly version: number;
}

export interface ScenarioActionDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly required: boolean;
  readonly allowedTelemetryDefinitionIds: readonly string[];
  readonly prerequisites?: readonly string[];
  readonly effects?: Readonly<Record<string, unknown>>;
}

export interface ScenarioSuccessCondition {
  readonly id: string;
  readonly description: string;
  readonly requiredActionIds: readonly string[];
  readonly telemetryAssertions: readonly TelemetryAssertion[];
}

export interface TelemetryAssertion {
  readonly definitionId: string;
  readonly operator: "EQ" | "GTE" | "LTE" | "BETWEEN" | "IN";
  readonly expected: number | string | boolean | readonly string[] | { min: number; max: number };
}

export interface DifficultyCompletionRule {
  readonly difficulty: ScenarioDifficulty;
  readonly successfulTransition: "PRACTICE" | "DEMONSTRATION";
  readonly minimumDecisionQuality: "BASIC" | "SOUND" | "EXPERT";
}

export interface LabScenario {
  readonly id: string;
  readonly version: number;
  readonly organisationId?: string;
  readonly vertical: DomainVertical;
  readonly title: string;
  readonly prompt: string;
  readonly difficulty: ScenarioDifficulty;
  readonly initialState: ScenarioState;
  readonly successCondition: ScenarioSuccessCondition;
  readonly allowedActions: readonly ScenarioActionDefinition[];
  readonly telemetryRules: readonly TelemetryRule[];
  readonly completion: DifficultyCompletionRule;
}

export interface LearnerDecision {
  readonly diagnosis: string;
  readonly rationale: string;
  readonly confidence: number;
  readonly selectedActionId: string;
}

export interface LabAction {
  readonly actionId: string;
  readonly decision: LearnerDecision;
  readonly telemetry: readonly TelemetryPayload[];
  readonly notes?: string;
}

export interface ActionContext {
  readonly scenarioId: string;
  readonly sessionId: string;
  readonly learnerId: string;
  readonly organisationId: string;
  readonly priorState: ScenarioState;
  readonly action: LabAction;
}

export interface ActionResult {
  readonly actionId: string;
  readonly accepted: true;
  readonly sessionId: string;
  readonly resultingState: ScenarioState;
  readonly telemetryObservationIds: readonly string[];
  readonly completed: boolean;
  readonly competencyTransition?: "PRACTICE" | "DEMONSTRATION";
}

export interface LabSession {
  readonly id: string;
  readonly organisationId: string;
  readonly learnerId: string;
  readonly competencyId: string;
  readonly scenarioId: string;
  readonly scenarioVersion: number;
  readonly status: ScenarioSessionStatus;
  readonly state: ScenarioState;
  readonly completedActionIds: readonly string[];
}

export interface ScenarioRepository {
  getById(id: string, organisationId: string): Promise<LabScenario | null>;
}

export interface LabSessionRepository {
  create(input: Omit<LabSession, "id">): Promise<LabSession>;
  getById(id: string): Promise<LabSession | null>;
  appendAction(input: { sessionId: string; action: LabAction; context: ActionContext; resultingState: ScenarioState; telemetryObservationIds: readonly string[] }): Promise<void>;
  complete(input: { sessionId: string; resultingState: ScenarioState; transition: "PRACTICE" | "DEMONSTRATION" }): Promise<void>;
}

export interface LabTelemetryRepository {
  append(input: {
    organisationId: string;
    practiceSessionId: string;
    telemetryDefinitionId: string;
    observedById: string;
    observedAt: string;
    value: TelemetryPayload["value"];
    unit?: string;
    method?: string;
    context: Readonly<Record<string, unknown>>;
  }): Promise<{ id: string }>;
}

export interface ScenarioAuthorizationPort {
  canWritePractice(claims: TokenClaims, organisationId: string, learnerId: string): Promise<boolean>;
}

export interface CompetencyTransitionPort {
  transition(input: {
    learnerCompetencyId: string;
    actorId: string;
    targetState: "PRACTICE" | "DEMONSTRATION";
    scenarioId: string;
    evidenceId?: string;
  }): Promise<void>;
}

export interface ScenarioTransaction {
  run<T>(work: () => Promise<T>): Promise<T>;
}
