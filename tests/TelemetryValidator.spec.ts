import { TelemetryValidator } from "../src/domain/measurement/validation/TelemetryValidator";

const validator = new TelemetryValidator();

validator.validate(
  { definitionId: "espresso.time.sec", value: { type: "DECIMAL", value: 28 }, unit: "s" },
  { definitionId: "espresso.time.sec", valueType: "DECIMAL", unit: "s", min: 1, max: 90, physicalMin: 0, physicalMax: 600 },
);

console.log("TelemetryValidator smoke test passed.");
