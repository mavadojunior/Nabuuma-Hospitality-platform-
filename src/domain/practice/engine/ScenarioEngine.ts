import type { TokenClaims } from "../../../infrastructure/security/security";
import { InvalidLabActionError, LabSessionNotFoundError, LabSessionStateError, ScenarioAuthorizationError, ScenarioNotFoundError } from "./errors";
import type { ActionContext, ActionResult, LabAction, LabScenario, LabSession, LabSessionRepository, LabTelemetryRepository, ScenarioAuthorizationPort, ScenarioRepository, ScenarioTransaction, ScenarioState, TelemetryAssertion } from "./types";
import { TelemetryValidator } from "../../measurement/validation/TelemetryValidator";
import type { CompetencyTransitionPort } from "./types";

export class ScenarioEngine {
  constructor(
    private readonly scenarios: ScenarioRepository,
    private readonly sessions: LabSessionRepository,
    private readonly telemetry: LabTelemetryRepository,
    private readonly authorization: ScenarioAuthorizationPort,
    private readonly competency: CompetencyTransitionPort,
    private readonly validator: TelemetryValidator,
    private readonly transaction: ScenarioTransaction,
  ) {}

  async initializeLabScenario(input: { sessionId?: string; organisationId: string; learnerId: string; competencyId: string; scenarioId: string; claims: TokenClaims }): Promise<LabSession> {
    const scenario = await this.scenarios.getById(input.scenarioId, input.organisationId);
    if (!scenario) throw new ScenarioNotFoundError(input.scenarioId);
    if (scenario.organisationId && scenario.organisationId !== input.organisationId) throw new ScenarioAuthorizationError("Scenario is outside the learner organisation scope.");
    if (!(await this.authorization.canWritePractice(input.claims, input.organisationId, input.learnerId))) throw new ScenarioAuthorizationError("Claims are not authorized to initialize this practice lab.");

    return this.sessions.create({
      organisationId: input.organisationId,
      learnerId: input.learnerId,
      competencyId: input.competencyId,
      scenarioId: scenario.id,
      scenarioVersion: scenario.version,
      status: "ACTIVE",
      state: scenario.initialState,
      completedActionIds: [],
    });
  }

  async executeLabAction(sessionId: string, action: LabAction, claims: TokenClaims): Promise<ActionResult> {
    return this.transaction.run(async () => {
      const session = await this.sessions.getById(sessionId);
      if (!session) throw new LabSessionNotFoundError(sessionId);
      if (session.status !== "ACTIVE") throw new LabSessionStateError(`Session '${sessionId}' is ${session.status}; actions are accepted only in ACTIVE sessions.`);
      if (session.learnerId !== claims.subject) throw new ScenarioAuthorizationError("The authenticated learner does not own this lab session.");
      if (!(await this.authorization.canWritePractice(claims, session.organisationId, session.learnerId))) throw new ScenarioAuthorizationError("Claims are not authorized to execute actions in this lab.");

      const scenario = await this.scenarios.getById(session.scenarioId, session.organisationId);
      if (!scenario) throw new ScenarioNotFoundError(session.scenarioId);
      if (scenario.version !== session.scenarioVersion) throw new LabSessionStateError("The scenario version changed after the session was initialized.");

      const actionDefinition = scenario.allowedActions.find((candidate) => candidate.id === action.actionId);
      if (!actionDefinition) throw new InvalidLabActionError(`Action '${action.actionId}' is not allowed by scenario '${scenario.id}'.`);
      if (actionDefinition.prerequisites?.some((id) => !session.completedActionIds.includes(id))) {
        throw new InvalidLabActionError(`Action '${action.actionId}' has unmet prerequisites.`);
      }
      if (action.decision.selectedActionId !== action.actionId) throw new InvalidLabActionError("Learner decision selectedActionId must match the executed action.");
      if (action.decision.confidence < 0 || action.decision.confidence > 1) throw new InvalidLabActionError("Decision confidence must be between 0 and 1.");

      const allowedIds = new Set(actionDefinition.allowedTelemetryDefinitionIds);
      const scenarioRules = new Map(scenario.telemetryRules.map((rule) => [rule.definitionId, rule]));
      const observationIds: string[] = [];

      for (const payload of action.telemetry) {
        if (!allowedIds.has(payload.definitionId)) throw new InvalidLabActionError(`Telemetry '${payload.definitionId}' is not permitted for action '${action.actionId}'.`);
        const rule = scenarioRules.get(payload.definitionId);
        if (!rule) throw new InvalidLabActionError(`No active telemetry rule exists for '${payload.definitionId}'.`);
        this.validator.validate(payload, rule);
        const observation = await this.telemetry.append({
          organisationId: session.organisationId,
          practiceSessionId: session.id,
          telemetryDefinitionId: payload.definitionId,
          observedById: claims.subject,
          observedAt: payload.observedAt ?? new Date().toISOString(),
          value: payload.value,
          ...(payload.unit ?? rule.unit ? { unit: payload.unit ?? rule.unit } : {}),
          ...(payload.method ? { method: payload.method } : {}),
          context: {
            ...(payload.context ?? {}),
            scenarioId: scenario.id,
            scenarioVersion: scenario.version,
            actionId: action.actionId,
            diagnosis: action.decision.diagnosis,
            rationale: action.decision.rationale,
            decisionConfidence: action.decision.confidence,
          },
        });
        observationIds.push(observation.id);
      }

      const nextActionIds = [...session.completedActionIds, action.actionId];
      const resultingState = this.reduceState(session.state, scenario, action, nextActionIds, action.telemetry);
      const completed = this.isSuccessful(scenario, session, resultingState);
      const context: ActionContext = { scenarioId: scenario.id, sessionId, learnerId: session.learnerId, organisationId: session.organisationId, priorState: session.state, action };

      await this.sessions.appendAction({ sessionId, action, context, resultingState, telemetryObservationIds: observationIds });

      if (completed) {
        const transition = scenario.completion.successfulTransition;
        await this.competency.transition({ learnerCompetencyId: session.competencyId, actorId: claims.subject, targetState: transition, scenarioId: scenario.id });
        await this.sessions.complete({ sessionId, resultingState, transition });
        return { actionId: action.actionId, accepted: true, sessionId, resultingState, telemetryObservationIds: observationIds, completed: true, competencyTransition: transition };
      }

      return { actionId: action.actionId, accepted: true, sessionId, resultingState: { ...resultingState, values: { ...resultingState.values, completedActionIds: nextActionIds } }, telemetryObservationIds: observationIds, completed: false };
    });
  }

  private reduceState(state: ScenarioState, scenario: LabScenario, action: LabAction, completedActionIds: readonly string[], telemetry: LabAction["telemetry"]): ScenarioState {
    const priorTelemetry = (state.values.telemetryByDefinition as Record<string, unknown> | undefined) ?? {};
    const nextTelemetry = { ...priorTelemetry };
    for (const payload of telemetry) nextTelemetry[payload.definitionId] = payload.value;
    return {
      version: state.version + 1,
      values: {
        ...state.values,
        completedActionIds,
        telemetryByDefinition: nextTelemetry,
        lastActionId: action.actionId,
        lastDiagnosis: action.decision.diagnosis,
        lastDecision: action.decision.rationale,
        decisionConfidence: action.decision.confidence,
        ...scenario.allowedActions.find((candidate) => candidate.id === action.actionId)?.effects,
      },
    };
  }

  private isSuccessful(scenario: LabScenario, session: LabSession, resultingState: ScenarioState): boolean {
    const completedActionIds = new Set((resultingState.values.completedActionIds as readonly string[] | undefined) ?? session.completedActionIds);
    if (!scenario.successCondition.requiredActionIds.every((id) => completedActionIds.has(id))) return false;
    return scenario.successCondition.telemetryAssertions.every((assertion) => this.assertTelemetry(assertion, resultingState));
  }

  private assertTelemetry(assertion: TelemetryAssertion, state: ScenarioState): boolean {
    const telemetry = (state.values.telemetryByDefinition as Record<string, { type: string; value: unknown }> | undefined) ?? {};
    const payload = telemetry[assertion.definitionId];
    if (!payload) return false;
    if (payload.type === "CATEGORICAL" || payload.type === "BOOLEAN") return assertion.operator === "EQ" && payload.value === assertion.expected;
    if (payload.type === "RANGE" || typeof payload.value !== "number") return false;
    const actual = payload.value;
    if (assertion.operator === "EQ") return typeof assertion.expected === "number" && actual === assertion.expected;
    if (assertion.operator === "GTE") return typeof assertion.expected === "number" && actual >= assertion.expected;
    if (assertion.operator === "LTE") return typeof assertion.expected === "number" && actual <= assertion.expected;
    if (assertion.operator === "BETWEEN") { const range = assertion.expected; return typeof range === "object" && "min" in range && "max" in range && actual >= range.min && actual <= range.max; }
    return false;
  }
}
