import type {
  TelemetryDefinition,
  TelemetryObservation,
  TelemetryRepository,
  TelemetryValueType,
  UUID,
} from "../../../domain/competency/repositories/contracts";
import { TenantBoundaryViolationError } from "../../../domain/competency/errors";
import type { PgExecutionContext } from "../transaction";
import { mapPgError } from "../error-mapping";

interface TelemetryDefinitionRow {
  id: string;
  stable_key: string;
  version: number;
  name: string;
  value_type: TelemetryValueType;
  canonical_unit: string | null;
  method: string | null;
  precision_scale: number | null;
  min_value: string | number | null;
  max_value: string | number | null;
  reference_standard: string | null;
}

interface TelemetryRow {
  id: string;
  organisation_id: string;
  practice_session_id: string;
  telemetry_definition_id: string;
  observed_by_id: string;
  instrument_id: string | null;
  observed_at: Date | string;
  value_numeric: string | number | null;
  value_integer: string | number | null;
  value_duration_ms: string | number | null;
  value_ratio: string | number | null;
  value_percentage: string | number | null;
  value_category: string | null;
  value_boolean: boolean | null;
  value_score: string | number | null;
  value_range: unknown | null;
  unit: string | null;
  method: string | null;
  quality_status: TelemetryObservation["qualityStatus"];
  context: unknown;
}

function numberValue(value: string | number | null): number | undefined {
  if (value === null) return undefined;
  return typeof value === "number" ? value : Number(value);
}

function mapDefinition(row: TelemetryDefinitionRow): TelemetryDefinition {
  const canonicalUnit = row.canonical_unit ?? undefined;
  const method = row.method ?? undefined;
  const precisionScale = row.precision_scale ?? undefined;
  const minValue = numberValue(row.min_value);
  const maxValue = numberValue(row.max_value);
  const referenceStandard = row.reference_standard ?? undefined;

  return {
    id: row.id,
    stableKey: row.stable_key,
    version: row.version,
    name: row.name,
    valueType: row.value_type,
    ...(canonicalUnit === undefined ? {} : { canonicalUnit }),
    ...(method === undefined ? {} : { method }),
    ...(precisionScale === undefined ? {} : { precisionScale }),
    ...(minValue === undefined ? {} : { minValue }),
    ...(maxValue === undefined ? {} : { maxValue }),
    ...(referenceStandard === undefined ? {} : { referenceStandard }),
  };
}

function mapContext(value: unknown): TelemetryObservation["context"] {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as TelemetryObservation["context"];
  }

  return {};
}

function mapValue(row: TelemetryRow): TelemetryObservation["value"] {
  if (row.value_numeric !== null) {
    return { type: "DECIMAL", value: Number(row.value_numeric) };
  }
  if (row.value_integer !== null) {
    return { type: "INTEGER", value: Number(row.value_integer) };
  }
  if (row.value_duration_ms !== null) {
    return { type: "DURATION_MS", value: Number(row.value_duration_ms) };
  }
  if (row.value_ratio !== null) {
    return { type: "RATIO", value: Number(row.value_ratio) };
  }
  if (row.value_percentage !== null) {
    return { type: "PERCENTAGE", value: Number(row.value_percentage) };
  }
  if (row.value_category !== null) {
    return { type: "CATEGORICAL", value: row.value_category };
  }
  if (row.value_boolean !== null) {
    return { type: "BOOLEAN", value: row.value_boolean };
  }
  if (row.value_score !== null) {
    return { type: "SCORE", value: Number(row.value_score) };
  }
  if (row.value_range !== null) {
    return {
      type: "RANGE",
      value: row.value_range as { min?: number; max?: number },
    };
  }

  throw new Error("Telemetry row violates the exactly-one-value invariant.");
}

function mapObservation(row: TelemetryRow): TelemetryObservation {
  const unit = row.unit ?? undefined;
  const method = row.method ?? undefined;
  const instrumentId = row.instrument_id ?? undefined;

  return {
    id: row.id,
    organisationId: row.organisation_id,
    practiceSessionId: row.practice_session_id,
    telemetryDefinitionId: row.telemetry_definition_id,
    observedById: row.observed_by_id,
    ...(instrumentId === undefined ? {} : { instrumentId }),
    observedAt:
      row.observed_at instanceof Date
        ? row.observed_at.toISOString()
        : row.observed_at,
    value: mapValue(row),
    ...(unit === undefined ? {} : { unit }),
    ...(method === undefined ? {} : { method }),
    qualityStatus: row.quality_status,
    context: mapContext(row.context),
  };
}

const NUMERIC_COLUMNS: Record<
  "DECIMAL" | "INTEGER" | "DURATION_MS" | "RATIO" | "PERCENTAGE" | "SCORE",
  string
> = {
  DECIMAL: "value_numeric",
  INTEGER: "value_integer",
  DURATION_MS: "value_duration_ms",
  RATIO: "value_ratio",
  PERCENTAGE: "value_percentage",
  SCORE: "value_score",
};

function isNumericType(
  valueType: TelemetryValueType,
): valueType is keyof typeof NUMERIC_COLUMNS {
  return valueType in NUMERIC_COLUMNS;
}

export class PgTelemetryRepository implements TelemetryRepository {
  constructor(private readonly context: PgExecutionContext) {}

  async getDefinition(id: UUID): Promise<TelemetryDefinition | null> {
    try {
      const result = await this.context.client.query<TelemetryDefinitionRow>(
        `
          SELECT
            id,
            stable_key,
            version,
            name,
            value_type,
            canonical_unit,
            method,
            precision_scale,
            min_value,
            max_value,
            reference_standard
          FROM nabuuma.telemetry_definitions
          WHERE id = $1
        `,
        [id],
      );

      const row = result.rows[0];
      return row ? mapDefinition(row) : null;
    } catch (error) {
      throw mapPgError(error, "telemetry");
    }
  }

  async record(
    observation: Omit<TelemetryObservation, "id">,
  ): Promise<TelemetryObservation> {
    if (observation.organisationId !== this.context.organisationId) {
      throw new TenantBoundaryViolationError();
    }

    if (observation.observedById !== this.context.claims.subject) {
      throw new TenantBoundaryViolationError(
        "The telemetry observer must match the authenticated database context.",
      );
    }

    const value = observation.value;

    const typedValues = {
      DECIMAL: [value.type === "DECIMAL" ? value.value : null],
      INTEGER: [value.type === "INTEGER" ? value.value : null],
      DURATION_MS: [value.type === "DURATION_MS" ? value.value : null],
      RATIO: [value.type === "RATIO" ? value.value : null],
      PERCENTAGE: [value.type === "PERCENTAGE" ? value.value : null],
      CATEGORICAL: [value.type === "CATEGORICAL" ? value.value : null],
      BOOLEAN: [value.type === "BOOLEAN" ? value.value : null],
      SCORE: [value.type === "SCORE" ? value.value : null],
      RANGE: [
        value.type === "RANGE" ? JSON.stringify(value.value) : null,
      ],
    };

    try {
      const result = await this.context.client.query<TelemetryRow>(
        `
          INSERT INTO nabuuma.telemetry_observations (
            organisation_id,
            practice_session_id,
            telemetry_definition_id,
            observed_by_id,
            instrument_id,
            observed_at,
            value_numeric,
            value_integer,
            value_duration_ms,
            value_ratio,
            value_percentage,
            value_category,
            value_boolean,
            value_score,
            value_range,
            unit,
            method,
            quality_status,
            context
          )
          SELECT
            $1,
            ps.id,
            td.id,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            $11,
            $12,
            $13,
            $14,
            $15::jsonb,
            $16,
            $17,
            $18,
            $19::jsonb
          FROM nabuuma.practice_sessions ps
          CROSS JOIN nabuuma.telemetry_definitions td
          LEFT JOIN nabuuma.instruments i
            ON i.id = $5
          WHERE ps.id = $2
            AND ps.organisation_id = $1
            AND td.id = $3
            AND (
              $5 IS NULL
              OR i.id IS NULL
              OR i.organisation_id IS NULL
              OR i.organisation_id = $1
            )
          RETURNING
            id,
            organisation_id,
            practice_session_id,
            telemetry_definition_id,
            observed_by_id,
            instrument_id,
            observed_at,
            value_numeric,
            value_integer,
            value_duration_ms,
            value_ratio,
            value_percentage,
            value_category,
            value_boolean,
            value_score,
            value_range,
            unit,
            method,
            quality_status,
            context
        `,
        [
          observation.organisationId,
          observation.practiceSessionId,
          observation.telemetryDefinitionId,
          observation.observedById,
          observation.instrumentId ?? null,
          observation.observedAt,
          typedValues.DECIMAL[0],
          typedValues.INTEGER[0],
          typedValues.DURATION_MS[0],
          typedValues.RATIO[0],
          typedValues.PERCENTAGE[0],
          typedValues.CATEGORICAL[0],
          typedValues.BOOLEAN[0],
          typedValues.SCORE[0],
          typedValues.RANGE[0],
          observation.unit ?? null,
          observation.method ?? null,
          observation.qualityStatus,
          JSON.stringify(observation.context),
        ],
      );

      const row = result.rows[0];
      if (!row) {
        throw new TenantBoundaryViolationError(
          "The practice session, telemetry definition, or instrument is outside the active tenant boundary.",
        );
      }

      return mapObservation(row);
    } catch (error) {
      if (error instanceof TenantBoundaryViolationError) throw error;
      throw mapPgError(error, "telemetry");
    }
  }

  async listForPracticeSession(
    practiceSessionId: UUID,
  ): Promise<TelemetryObservation[]> {
    try {
      const result = await this.context.client.query<TelemetryRow>(
        `
          SELECT
            id,
            organisation_id,
            practice_session_id,
            telemetry_definition_id,
            observed_by_id,
            instrument_id,
            observed_at,
            value_numeric,
            value_integer,
            value_duration_ms,
            value_ratio,
            value_percentage,
            value_category,
            value_boolean,
            value_score,
            value_range,
            unit,
            method,
            quality_status,
            context
          FROM nabuuma.telemetry_observations
          WHERE practice_session_id = $1
            AND organisation_id = $2
          ORDER BY observed_at ASC, id ASC
        `,
        [practiceSessionId, this.context.organisationId],
      );

      return result.rows.map(mapObservation);
    } catch (error) {
      throw mapPgError(error, "telemetry");
    }
  }

  async findNumericRange(
    telemetryDefinitionId: UUID,
    min: number,
    max: number,
  ): Promise<TelemetryObservation[]> {
    const definition = await this.getDefinition(telemetryDefinitionId);

    if (!definition) return [];

    if (!isNumericType(definition.valueType)) return [];

    /*
     * The column name is selected from a closed, compile-time mapping, never
     * from user input. This preserves the dedicated partial indexes:
     * idx_telemetry_numeric / integer / duration.
     */
    const column = NUMERIC_COLUMNS[definition.valueType];

    try {
      const result = await this.context.client.query<TelemetryRow>(
        `
          SELECT
            id,
            organisation_id,
            practice_session_id,
            telemetry_definition_id,
            observed_by_id,
            instrument_id,
            observed_at,
            value_numeric,
            value_integer,
            value_duration_ms,
            value_ratio,
            value_percentage,
            value_category,
            value_boolean,
            value_score,
            value_range,
            unit,
            method,
            quality_status,
            context
          FROM nabuuma.telemetry_observations
          WHERE telemetry_definition_id = $1
            AND organisation_id = $2
            AND ${column} BETWEEN $3 AND $4
          ORDER BY ${column} ASC, observed_at ASC, id ASC
        `,
        [telemetryDefinitionId, this.context.organisationId, min, max],
      );

      return result.rows.map(mapObservation);
    } catch (error) {
      throw mapPgError(error, "telemetry");
    }
  }
}
