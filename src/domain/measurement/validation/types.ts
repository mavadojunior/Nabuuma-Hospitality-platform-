export type TelemetryScalar = number | string | boolean;

export type TelemetryValue =
  | { type: "DECIMAL"; value: number }
  | { type: "INTEGER"; value: number }
  | { type: "DURATION_MS"; value: number }
  | { type: "RATIO"; value: number }
  | { type: "PERCENTAGE"; value: number }
  | { type: "CATEGORICAL"; value: string }
  | { type: "BOOLEAN"; value: boolean }
  | { type: "SCORE"; value: number }
  | { type: "RANGE"; value: { min?: number; max?: number } };

export interface TelemetryPayload {
  readonly definitionId: string;
  readonly value: TelemetryValue;
  readonly unit?: string;
  readonly method?: string;
  readonly observedAt?: string;
  readonly instrumentId?: string;
  readonly context?: Readonly<Record<string, unknown>>;
}

export interface TelemetryRule {
  readonly definitionId: string;
  readonly valueType: TelemetryValue["type"];
  readonly unit?: string;
  readonly min?: number;
  readonly max?: number;
  readonly allowedValues?: readonly string[];
  readonly integerOnly?: boolean;
  readonly physicalMin?: number;
  readonly physicalMax?: number;
}
