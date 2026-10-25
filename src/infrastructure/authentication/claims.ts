import type { JWTPayload } from "jose";
import type {
  SecurityRole,
  TokenClaims,
} from "../security/security.js";
import { AuthenticationError } from "./errors.js";

const ACCEPTED_ROLES = new Set<SecurityRole>([
  "LEARNER",
  "PROFESSIONAL",
  "TRAINER",
  "ORGANISATION_MANAGER",
  "ORGANISATION_OWNER",
  "PLATFORM_ADMIN",
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseRoles(value: unknown): SecurityRole[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every(
      (role): role is SecurityRole =>
        typeof role === "string" &&
        ACCEPTED_ROLES.has(role as SecurityRole),
    )
  ) {
    throw new AuthenticationError();
  }

  return [...new Set(value)];
}

export function mapJwtPayloadToTokenClaims(
  payload: JWTPayload,
): TokenClaims {
  if (
    !isNonEmptyString(payload.sub) ||
    !isNonEmptyString(payload.organisation_id)
  ) {
    throw new AuthenticationError();
  }

  return {
    subject: payload.sub,
    organisationId: payload.organisation_id,
    roles: parseRoles(payload.roles),
  };
}
