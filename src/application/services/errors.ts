export class DomainError extends Error { constructor(public readonly code: string, message: string){ super(message); this.name = "DomainError"; } }
export class AuthorizationError extends DomainError { constructor(message:string){ super("AUTHORIZATION_DENIED", message); this.name="AuthorizationError"; } }
export class InvalidCompetencyTransitionError extends DomainError { constructor(from:string,to:string){ super("INVALID_COMPETENCY_TRANSITION",`Invalid competency transition: ${from} -> ${to}`); this.name="InvalidCompetencyTransitionError"; } }
export class VerificationRequiredError extends DomainError { constructor(message="Verified competency requires an authorized assessor, assessment, and linked evidence."){ super("VERIFICATION_REQUIRED",message); this.name="VerificationRequiredError"; } }
export class TelemetryValidationError extends DomainError { constructor(message:string){ super("TELEMETRY_VALIDATION_FAILED",message); this.name="TelemetryValidationError"; } }
