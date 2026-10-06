import { describe, expect, it } from "vitest";
import { TelemetryValidator } from "../src/domain/measurement/validation/TelemetryValidator";

describe("TelemetryValidator", () => {
  const validator = new TelemetryValidator();

  it("accepts a valid espresso extraction time", () => {
    expect(() =>
      validator.validate(
        {
          definitionId: "espresso.time.sec",
          value: { type: "DECIMAL", value: 28 },
          unit: "s",
        },
        {
          definitionId: "espresso.time.sec",
          valueType: "DECIMAL",
          unit: "s",
          min: 1,
          max: 90,
          physicalMin: 0,
          physicalMax: 600,
        },
      ),
    ).not.toThrow();
  });

  it("rejects telemetry outside the declared physical bounds", () => {
    expect(() =>
      validator.validate(
        {
          definitionId: "espresso.time.sec",
          value: { type: "DECIMAL", value: 700 },
          unit: "s",
        },
        {
          definitionId: "espresso.time.sec",
          valueType: "DECIMAL",
          unit: "s",
          min: 1,
          max: 90,
          physicalMin: 0,
          physicalMax: 600,
        },
      ),
    ).toThrow();
  });
});
