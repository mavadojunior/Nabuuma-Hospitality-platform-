export class PracticeDomainError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ScenarioNotFoundError extends PracticeDomainError {
  constructor(id: string) { super("SCENARIO_NOT_FOUND", `Scenario '${id}' was not found.`); }
}

export class LabSessionNotFoundError extends PracticeDomainError {
  constructor(id: string) { super("LAB_SESSION_NOT_FOUND", `Lab session '${id}' was not found.`); }
}

export class LabSessionStateError extends PracticeDomainError {
  constructor(message: string) { super("LAB_SESSION_STATE_INVALID", message); }
}

export class InvalidLabActionError extends PracticeDomainError {
  constructor(message: string) { super("INVALID_LAB_ACTION", message); }
}

export class InvalidTelemetryBoundsError extends PracticeDomainError {
  constructor(message: string) { super("INVALID_TELEMETRY_BOUNDS", message); }
}

export class ScenarioBoundaryViolationError extends PracticeDomainError {
  constructor(message: string) { super("SCENARIO_BOUNDARY_VIOLATION", message); }
}

export class ScenarioAuthorizationError extends PracticeDomainError {
  constructor(message: string) { super("SCENARIO_AUTHORIZATION_DENIED", message); }
}
