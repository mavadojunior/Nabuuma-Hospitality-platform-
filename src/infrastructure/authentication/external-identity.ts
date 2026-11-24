import type { Pool } from "pg";
import type { SecurityRole, TokenClaims } from "../security/security.js";
import { AuthenticationError } from "./errors.js";

export type IdentityProvider = "AUTH0" | "SUPABASE";

export interface AuthenticatedExternalPrincipal {
  readonly provider: IdentityProvider;
  readonly externalSubject: string;
  readonly requestedOrganisationId?: string;
  readonly assertedRoles?: readonly SecurityRole[];
}

export interface ActiveMembership {
  readonly organisationId: string;
  readonly persistenceRole:
    | "LEARNER"
    | "PROFESSIONAL"
    | "ASSESSOR"
    | "MANAGER"
    | "CONTENT_EDITOR"
    | "ORGANISATION_OWNER"
    | "PLATFORM_ADMIN";
  readonly active: boolean;
}

export interface ResolvedExternalIdentity {
  readonly userId: string;
  readonly membership: ActiveMembership;
}

export interface ExternalIdentityRepository {
  resolveIdentity(
    provider: IdentityProvider,
    externalSubject: string,
    requestedOrganisationId?: string,
  ): Promise<ResolvedExternalIdentity | null>;
}

/**
 * Concrete repository calling the restricted pre-transaction resolver function.
 * No direct SELECT privileges on identity or membership tables are required by
 * the runtime. The function must be installed and privilege-tested separately.
 */
export class PgExternalIdentityRepository implements ExternalIdentityRepository {
  constructor(private readonly pool: Pool) {}

  async resolveIdentity(
    provider: IdentityProvider,
    externalSubject: string,
    requestedOrganisationId?: string,
  ): Promise<ResolvedExternalIdentity | null> {
    const result = await this.pool.query<{
      user_id: string;
      organisation_id: string;
      role: ActiveMembership["persistenceRole"];
    }>(
      `SELECT user_id::text AS user_id,
              organisation_id::text AS organisation_id,
              role::text AS role
         FROM nabuuma.resolve_external_identity($1, $2, $3::uuid)`,
      [provider, externalSubject, requestedOrganisationId ?? null],
    );
    if (result.rows.length === 0) return null;
    if (result.rows.length !== 1) throw new AuthenticationError();
    const row = result.rows[0];
    if (!row) throw new AuthenticationError();
    return {
      userId: row.user_id,
      membership: {
        organisationId: row.organisation_id,
        persistenceRole: row.role,
        active: true,
      },
    };
  }
}

const ROLE_MAP: Readonly<Partial<Record<ActiveMembership["persistenceRole"], SecurityRole>>> = {
  LEARNER: "LEARNER",
  PROFESSIONAL: "PROFESSIONAL",
  ASSESSOR: "TRAINER",
  MANAGER: "ORGANISATION_MANAGER",
  ORGANISATION_OWNER: "ORGANISATION_OWNER",
  PLATFORM_ADMIN: "PLATFORM_ADMIN",
};

const SECURITY_ROLES = new Set<SecurityRole>([
  "LEARNER", "PROFESSIONAL", "TRAINER", "ORGANISATION_MANAGER",
  "ORGANISATION_OWNER", "PLATFORM_ADMIN",
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUTH0_NAMESPACE = "https://api.nabuuma.com";

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseAssertedRoles(value: unknown): readonly SecurityRole[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 ||
      !value.every((role) => typeof role === "string" && SECURITY_ROLES.has(role as SecurityRole))) {
    throw new AuthenticationError();
  }
  return [...new Set(value as SecurityRole[])];
}

/** Extracts Auth0-specific namespaced claims only after JWT signature and standard claim verification. */
export function mapVerifiedAuth0Payload(payload: Readonly<Record<string, unknown>>): AuthenticatedExternalPrincipal {
  const subject = payload.sub;
  const organisation = payload[`${AUTH0_NAMESPACE}/organisation_id`];
  const roles = parseAssertedRoles(payload[`${AUTH0_NAMESPACE}/roles`]);

  if (!nonEmptyString(subject) || subject.length > 255) throw new AuthenticationError();
  if (organisation !== undefined && (!nonEmptyString(organisation) || !UUID_PATTERN.test(organisation))) {
    throw new AuthenticationError();
  }
  return {
    provider: "AUTH0",
    externalSubject: subject,
    ...(organisation === undefined ? {} : { requestedOrganisationId: organisation }),
    ...(roles === undefined ? {} : { assertedRoles: roles }),
  };
}

/** Resolves external identity and tenant authority exclusively through repository data. */
export class ExternalIdentityResolver {
  constructor(private readonly repository: ExternalIdentityRepository) {}

  async resolve(principal: AuthenticatedExternalPrincipal): Promise<TokenClaims> {
    if (!nonEmptyString(principal.externalSubject) || principal.externalSubject.length > 255) {
      throw new AuthenticationError();
    }
    const resolved = await this.repository.resolveIdentity(
      principal.provider,
      principal.externalSubject,
      principal.requestedOrganisationId,
    );
    if (!resolved || !UUID_PATTERN.test(resolved.userId)) throw new AuthenticationError();
    const membership = resolved.membership;
    if (!membership.active || !UUID_PATTERN.test(membership.organisationId)) throw new AuthenticationError();
    const userId = resolved.userId;
    const role = ROLE_MAP[membership.persistenceRole];
    if (!role) throw new AuthenticationError();
    if (principal.assertedRoles && (principal.assertedRoles.length !== 1 || principal.assertedRoles[0] !== role)) {
      throw new AuthenticationError();
    }
    return { subject: userId, organisationId: membership.organisationId, roles: [role] };
  }
}
