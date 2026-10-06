import {
  DomainConstraintError,
  DomainStateTransitionError,
  TenantBoundaryViolationError,
} from "../../domain/competency/errors";

interface PgErrorLike {
  code?: string;
  constraint?: string;
  message?: string;
}

function asPgError(error: unknown): PgErrorLike | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const candidate = error as Record<string, unknown>;

  const result: PgErrorLike = {};

  if (typeof candidate.code === "string") {
    result.code = candidate.code;
  }

  if (typeof candidate.constraint === "string") {
    result.constraint = candidate.constraint;
  }

  if (typeof candidate.message === "string") {
    result.message = candidate.message;
  }

  return result;
}

export function mapPgError(
  error: unknown,
  operation: "competency" | "telemetry" | "assessment",
): Error {
  const pgError = asPgError(error);

  if (!pgError) {
    return error instanceof Error ? error : new Error("Unknown database error.");
  }

  const message = pgError.message ?? "Database operation failed.";

  /*
   * RLS violations are authorization/tenant-boundary failures, not
   * infrastructure errors that callers should have to understand.
   */
  if (
    pgError.code === "42501" &&
    /row-level security|policy|permission denied/i.test(message)
  ) {
    return new TenantBoundaryViolationError(
      "The database rejected the operation outside the active tenant boundary.",
    );
  }

  /*
   * PostgreSQL trigger exceptions are intentionally mapped without exposing
   * their raw database message. The database remains authoritative for the
   * actual invariant.
   */
  if (
    operation === "competency" &&
    (pgError.code === "P0001" ||
      pgError.code === "27000" ||
      /competency transition|verified competency|authorized assessor|verification/i.test(
        message,
      ))
  ) {
    return new DomainStateTransitionError(
      "The database rejected the requested competency state transition.",
    );
  }

  if (
    /tenant|organisation|organization/i.test(message) &&
    (pgError.code === "P0001" || pgError.code === "27000")
  ) {
    return new TenantBoundaryViolationError();
  }

  switch (pgError.code) {
    case "23505":
      return new DomainConstraintError(
        `The ${operation} operation violates a uniqueness constraint.`,
      );
    case "23503":
      return new DomainConstraintError(
        `The ${operation} operation references a resource that does not exist or cannot be changed.`,
      );
    case "23514":
    case "23502":
      return new DomainConstraintError(
        `The ${operation} operation violates a database invariant.`,
      );
    default:
      return new DomainConstraintError(
        `The ${operation} operation was rejected by a database constraint.`,
      );
  }
}
