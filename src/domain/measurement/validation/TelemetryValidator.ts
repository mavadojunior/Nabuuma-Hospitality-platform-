import { InvalidTelemetryBoundsError, ScenarioBoundaryViolationError } from "../../practice/engine/errors";
import type { TelemetryPayload, TelemetryRule, TelemetryValue } from "./types";

export interface TelemetryValidationResult {
  readonly normalized: TelemetryPayload;
}

export class TelemetryValidator {
  validate(payload: TelemetryPayload, rule: TelemetryRule): TelemetryValidationResult {
    if (payload.definitionId !== rule.definitionId) {
      throw new ScenarioBoundaryViolationError(`Telemetry definition '${payload.definitionId}' is not allowed by the active scenario rule '${rule.definitionId}'.`);
    }

    if (payload.value.type !== rule.valueType) {
      throw new InvalidTelemetryBoundsError(`Telemetry '${rule.definitionId}' expects ${rule.valueType}, received ${payload.value.type}.`);
    }

    if (rule.unit && payload.unit && payload.unit !== rule.unit) {
      throw new InvalidTelemetryBoundsError(`Telemetry '${rule.definitionId}' expects unit '${rule.unit}', received '${payload.unit}'.`);
    }

    this.validateValue(payload.value, rule);
    this.validatePhysicalBounds(payload.value, rule);

    if (rule.allowedValues && payload.value.type === "CATEGORICAL" && !rule.allowedValues.includes(payload.value.value)) {
      throw new InvalidTelemetryBoundsError(`Value '${payload.value.value}' is outside the allowed categorical values for '${rule.definitionId}'.`);
    }

    return { normalized: payload };
  }

  private validateValue(value: TelemetryValue, rule: TelemetryRule): void {
    if (value.type === "DECIMAL" || value.type === "INTEGER" || value.type === "DURATION_MS" || value.type === "RATIO" || value.type === "PERCENTAGE" || value.type === "SCORE") {
      if (!Number.isFinite(value.value)) throw new InvalidTelemetryBoundsError(`Telemetry '${rule.definitionId}' must be a finite number.`);
      if (value.type === "INTEGER" && !Number.isInteger(value.value)) throw new InvalidTelemetryBoundsError(`Telemetry '${rule.definitionId}' requires an integer.`);
      if (value.type === "DURATION_MS" && value.value < 0) throw new InvalidTelemetryBoundsError(`Telemetry '${rule.definitionId}' cannot have a negative duration.`);
      if (value.type === "PERCENTAGE" && (value.value < 0 || value.value > 100)) throw new InvalidTelemetryBoundsError(`Percentage '${rule.definitionId}' must be between 0 and 100.`);
      if (rule.min !== undefined && value.value < rule.min) throw new InvalidTelemetryBoundsError(`Telemetry '${rule.definitionId}' is below the scenario minimum of ${rule.min}.`);
      if (rule.max !== undefined && value.value > rule.max) throw new InvalidTelemetryBoundsError(`Telemetry '${rule.definitionId}' exceeds the scenario maximum of ${rule.max}.`);
    }

    if (value.type === "RANGE") {
      const { min, max } = value.value;
      if (min !== undefined && !Number.isFinite(min)) throw new InvalidTelemetryBoundsError(`Range minimum for '${rule.definitionId}' must be finite.`);
      if (max !== undefined && !Number.isFinite(max)) throw new InvalidTelemetryBoundsError(`Range maximum for '${rule.definitionId}' must be finite.`);
      if (min !== undefined && max !== undefined && min > max) throw new InvalidTelemetryBoundsError(`Range minimum cannot exceed maximum for '${rule.definitionId}'.`);
    }
  }

  private validatePhysicalBounds(value: TelemetryValue, rule: TelemetryRule): void {
    if (rule.physicalMin === undefined && rule.physicalMax === undefined) return;
    const scalar = value.type === "RANGE" ? undefined : typeof value.value === "number" ? value.value : undefined;
    if (scalar === undefined) return;
    if (rule.physicalMin !== undefined && scalar < rule.physicalMin) throw new ScenarioBoundaryViolationError(`Telemetry '${rule.definitionId}' is physically impossible below ${rule.physicalMin}.`);
    if (rule.physicalMax !== undefined && scalar > rule.physicalMax) throw new ScenarioBoundaryViolationError(`Telemetry '${rule.definitionId}' is physically impossible above ${rule.physicalMax}.`);
  }
}
