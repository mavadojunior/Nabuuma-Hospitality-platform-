import {
  PracticeSession,
  PracticeSessionRepository,
  TelemetryContext,
  TelemetryDefinition,
  TelemetryObservation,
  TelemetryRepository,
  UUID,
} from "../../domain/competency/repositories/contracts";
import {
  AuthorizationError,
  TelemetryValidationError,
} from "./errors";

export interface PracticeAuthorizationPort {
  canWritePractice(
    userId: UUID,
    organisationId: UUID,
    learnerId: UUID,
  ): Promise<boolean>;
}

export interface TelemetryObservationInput {
  telemetryDefinitionId: UUID;
  observedById: UUID;
  instrumentId?: UUID;
  observedAt?: string;
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
  context?: Record<string, unknown>;
}

export interface PracticeTransaction {
  run<T>(work: () => Promise<T>): Promise<T>;
}

function toTelemetryContext(
  context: Record<string, unknown>,
): TelemetryContext {
  const result: TelemetryContext = {};

  for (const [key, value] of Object.entries(context)) {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      (Array.isArray(value) &&
        value.every((item) => typeof item === "string")) ||
      (Array.isArray(value) &&
        value.every((item) => typeof item === "number"))
    ) {
      result[key] = value;
    }
  }

  return result;
}

export class PracticeSessionService {
  constructor(
    private readonly sessions: PracticeSessionRepository,
    private readonly telemetry: TelemetryRepository,
    private readonly authorization: PracticeAuthorizationPort,
    private readonly transaction: PracticeTransaction,
  ) {}

  async openSession(input: {
    organisationId: UUID;
    learnerId: UUID;
    competencyId: UUID;
    actorId: UUID;
    brief?: Record<string, unknown>;
    context?: Record<string, unknown>;
  }): Promise<PracticeSession> {
    if (
      !(await this.authorization.canWritePractice(
        input.actorId,
        input.organisationId,
        input.learnerId,
      ))
    ) {
      throw new AuthorizationError(
        "Actor is not permitted to open this learner practice session.",
      );
    }

    return this.sessions.create({
      organisationId: input.organisationId,
      learnerId: input.learnerId,
      competencyId: input.competencyId,
      status: "IN_PROGRESS",
      brief: input.brief ?? {},
      context: input.context ?? {},
    });
  }

  async recordTelemetry(
    actorId: UUID,
    sessionId: UUID,
    input: TelemetryObservationInput,
  ): Promise<TelemetryObservation> {
    return this.transaction.run(async () => {
      const session = await this.sessions.getById(sessionId);

      if (!session) {
        throw new TelemetryValidationError(
          "Practice session does not exist.",
        );
      }

      if (
        !(await this.authorization.canWritePractice(
          actorId,
          session.organisationId,
          session.learnerId,
        ))
      ) {
        throw new AuthorizationError(
          "Actor is not permitted to write telemetry for this session.",
        );
      }

      if (session.status !== "IN_PROGRESS") {
        throw new TelemetryValidationError(
          `Telemetry cannot be appended while session status is ${session.status}.`,
        );
      }

      const definition = await this.telemetry.getDefinition(
        input.telemetryDefinitionId,
      );

      if (!definition) {
        throw new TelemetryValidationError(
          "Telemetry definition does not exist.",
        );
      }

      this.validateAgainstDefinition(definition, input);

      const observation: Omit<TelemetryObservation, "id"> = {
        organisationId: session.organisationId,
        practiceSessionId: session.id,
        telemetryDefinitionId: definition.id,
        observedById: actorId,
        observedAt:
          input.observedAt ?? new Date().toISOString(),
        value: input.value,
        qualityStatus: "UNVERIFIED",
        context: toTelemetryContext({
          ...session.context,
          ...(input.context ?? {}),
        }),
      };

      if (input.instrumentId !== undefined) {
        observation.instrumentId = input.instrumentId;
      }

      const unit = input.unit ?? definition.canonicalUnit;
      if (unit !== undefined) {
        observation.unit = unit;
      }

      const method = input.method ?? definition.method;
      if (method !== undefined) {
        observation.method = method;
      }

      return this.telemetry.record(observation);
    });
  }

  private validateAgainstDefinition(
    definition: TelemetryDefinition,
    input: TelemetryObservationInput,
  ): void {
    if (input.value.type !== definition.valueType) {
      throw new TelemetryValidationError(
        `Expected ${definition.valueType}; received ${input.value.type}.`,
      );
    }

    const scalar =
      "value" in input.value &&
      typeof input.value.value === "number"
        ? input.value.value
        : undefined;

    if (
      scalar !== undefined &&
      definition.minValue !== undefined &&
      scalar < definition.minValue
    ) {
      throw new TelemetryValidationError(
        "Telemetry value is below the active definition minimum.",
      );
    }

    if (
      scalar !== undefined &&
      definition.maxValue !== undefined &&
      scalar > definition.maxValue
    ) {
      throw new TelemetryValidationError(
        "Telemetry value exceeds the active definition maximum.",
      );
    }

    if (
      input.value.type === "PERCENTAGE" &&
      (input.value.value < 0 || input.value.value > 100)
    ) {
      throw new TelemetryValidationError(
        "Percentage telemetry must be between 0 and 100.",
      );
    }

    if (
      input.value.type === "DURATION_MS" &&
      input.value.value < 0
    ) {
      throw new TelemetryValidationError(
        "Duration cannot be negative.",
      );
    }

    if (
      input.value.type === "RANGE" &&
      input.value.value.min !== undefined &&
      input.value.value.max !== undefined &&
      input.value.value.min > input.value.value.max
    ) {
      throw new TelemetryValidationError(
        "Range minimum cannot exceed its maximum.",
      );
    }
  }
}
