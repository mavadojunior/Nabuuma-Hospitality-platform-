export class DomainStateTransitionError extends Error {
  readonly code = "DOMAIN_STATE_TRANSITION_INVALID" as const;

  constructor(message: string) {
    super(message);
    this.name = "DomainStateTransitionError";
  }
}

export class TenantBoundaryViolationError extends Error {
  readonly code = "TENANT_BOUNDARY_VIOLATION" as const;

  constructor(message = "The requested resource is outside the active organisation boundary.") {
    super(message);
    this.name = "TenantBoundaryViolationError";
  }
}

export class DomainConstraintError extends Error {
  readonly code = "DOMAIN_CONSTRAINT_VIOLATION" as const;

  constructor(message: string) {
    super(message);
    this.name = "DomainConstraintError";
  }
}
