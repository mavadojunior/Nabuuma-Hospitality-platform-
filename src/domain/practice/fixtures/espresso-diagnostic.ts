import type { LabScenario } from "../engine/types";

export const espressoDiagnosticScenario: LabScenario = {
  id: "coffee.espresso-diagnostic.v1",
  version: 1,
  vertical: "COFFEE",
  title: "Espresso Diagnostic",
  prompt: "Espresso has become fast and sharp in flavor. Diagnose and adjust the extraction using measured evidence rather than guessing.",
  difficulty: "ADVANCED",
  initialState: {
    version: 1,
    values: {
      doseTargetG: 18,
      expectedYieldG: 36,
      expectedTimeSecMin: 25,
      expectedTimeSecMax: 30,
      sensoryComplaint: "sharp_and_fast",
      grinderSetting: "unknown",
    },
  },
  successCondition: {
    id: "espresso-balanced-extraction",
    description: "Learner identifies a fast/sharp extraction, makes a defensible grind adjustment, and verifies the corrected shot with measured evidence.",
    requiredActionIds: ["diagnose-shot", "adjust-grind", "verify-shot"],
    telemetryAssertions: [
      { definitionId: "espresso.time.sec", operator: "BETWEEN", expected: { min: 25, max: 30 } },
      { definitionId: "espresso.yield.g", operator: "BETWEEN", expected: { min: 34, max: 38 } },
    ],
  },
  allowedActions: [
    {
      id: "diagnose-shot",
      label: "Diagnose extraction",
      description: "Record the observed dose, yield, time and sensory diagnosis before changing a variable.",
      required: true,
      allowedTelemetryDefinitionIds: ["espresso.dose.g", "espresso.yield.g", "espresso.time.sec"],
    },
    {
      id: "adjust-grind",
      label: "Adjust grind",
      description: "Select a grind adjustment and state why it should address the measured failure mode.",
      required: true,
      allowedTelemetryDefinitionIds: ["espresso.grind.direction", "espresso.grind.steps"],
      prerequisites: ["diagnose-shot"],
      effects: { grinderAdjustmentRecorded: true },
    },
    {
      id: "verify-shot",
      label: "Verify extraction",
      description: "Pull the next shot and verify the result against the scenario target.",
      required: true,
      allowedTelemetryDefinitionIds: ["espresso.time.sec", "espresso.yield.g", "espresso.tds.percent"],
      prerequisites: ["diagnose-shot", "adjust-grind"],
      effects: { verificationAttempted: true },
    },
  ],
  telemetryRules: [
    { definitionId: "espresso.dose.g", valueType: "DECIMAL", unit: "g", min: 5, max: 30, physicalMin: 0, physicalMax: 100 },
    { definitionId: "espresso.yield.g", valueType: "DECIMAL", unit: "g", min: 5, max: 80, physicalMin: 0, physicalMax: 200 },
    { definitionId: "espresso.time.sec", valueType: "DECIMAL", unit: "s", min: 1, max: 90, physicalMin: 0, physicalMax: 600 },
    { definitionId: "espresso.tds.percent", valueType: "PERCENTAGE", unit: "%", min: 0.5, max: 20, physicalMin: 0, physicalMax: 100 },
    { definitionId: "espresso.grind.steps", valueType: "INTEGER", unit: "steps", min: 1, max: 20, physicalMin: 1, physicalMax: 100 },
    { definitionId: "espresso.grind.direction", valueType: "CATEGORICAL", unit: "direction", allowedValues: ["FINER", "COARSER"] },
  ],
  completion: {
    difficulty: "ADVANCED",
    successfulTransition: "DEMONSTRATION",
    minimumDecisionQuality: "SOUND",
  },
};
