export type SecurityRole = "LEARNER" | "PROFESSIONAL" | "TRAINER" | "ORGANISATION_MANAGER" | "ORGANISATION_OWNER" | "PLATFORM_ADMIN";
export interface TokenClaims {
  readonly subject: string;
  readonly roles: readonly SecurityRole[];
  readonly organisationId: string;
  readonly scopeOrganisationIds?: readonly string[];
}
