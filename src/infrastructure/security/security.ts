import { UUID } from "../../domain/competency/repositories/contracts";
import { AuthorizationError } from "../../application/services/errors";
export type SecurityRole="LEARNER"|"PROFESSIONAL"|"TRAINER"|"ORGANISATION_MANAGER"|"ORGANISATION_OWNER"|"PLATFORM_ADMIN";
export interface TokenClaims{subject:UUID;roles:readonly SecurityRole[];organisationId:UUID;scopeOrganisationIds?:readonly UUID[];}
export interface OrganisationNode{id:UUID;parentId?:UUID;level:"ENTERPRISE"|"REGION"|"VENUE"|"TEAM";}
export interface OrganisationHierarchyRepository{getNode(id:UUID):Promise<OrganisationNode|null>;isDescendantOrSame(nodeId:UUID,ancestorId:UUID):Promise<boolean>;}
export interface SecurityContext {
  readonly userId: UUID;
  readonly organisationId: UUID;
  readonly roles: readonly SecurityRole[];
  readonly scopeOrganisationIds?: readonly UUID[];
  readonly correlationId: string;
}

/**
 * Build an immutable application context from already-verified claims.
 * The correlation ID must be supplied by trusted request infrastructure.
 */
export function createSecurityContext(
  claims: TokenClaims,
  correlationId: string,
): SecurityContext {
  if (typeof claims.subject !== "string" || !claims.subject.trim()) {
    throw new Error("Verified claims must include a subject.");
  }
  if (typeof claims.organisationId !== "string" || !claims.organisationId.trim()) {
    throw new Error("Verified claims must include an organisation.");
  }
  if (!Array.isArray(claims.roles) || claims.roles.length === 0) {
    throw new Error("Verified claims must include at least one role.");
  }
  if (typeof correlationId !== "string" || !correlationId.trim()) {
    throw new Error("A correlation ID is required.");
  }

  const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!UUID_PATTERN.test(correlationId)) {
    throw new Error("A correlation ID must be a valid UUID.");
  }

  const allowedRoles: readonly SecurityRole[] = [
    "LEARNER",
    "PROFESSIONAL",
    "TRAINER",
    "ORGANISATION_MANAGER",
    "ORGANISATION_OWNER",
    "PLATFORM_ADMIN",
  ];

  if (!claims.roles.every((role) => allowedRoles.includes(role))) {
    throw new Error("Verified claims contain an unsupported role.");
  }

  if (
    claims.scopeOrganisationIds !== undefined &&
    (!Array.isArray(claims.scopeOrganisationIds) ||
      !claims.scopeOrganisationIds.every(
        (id) => typeof id === "string" && id.trim().length > 0,
      ))
  ) {
    throw new Error("Verified claims contain an invalid organisation scope.");
  }

  const roles = Object.freeze([...claims.roles]);
  const scopeOrganisationIds = claims.scopeOrganisationIds === undefined
    ? undefined
    : Object.freeze([...claims.scopeOrganisationIds]);

  return Object.freeze({
    userId: claims.subject,
    organisationId: claims.organisationId,
    roles,
    ...(scopeOrganisationIds === undefined ? {} : { scopeOrganisationIds }),
    correlationId,
  });
}
export interface SecurityPolicy{canAuditTelemetry(c:SecurityContext,target:UUID):Promise<boolean>;canWritePractice(c:SecurityContext,target:UUID):Promise<boolean>;canVerifyCompetency(c:SecurityContext,target:UUID):Promise<boolean>;}

export class TenantRbacPolicy implements SecurityPolicy{
  constructor(private readonly hierarchy:OrganisationHierarchyRepository){}
  async canAuditTelemetry(c:SecurityContext,target:UUID){return (await this.inScope(c,target))&&(this.has(c,"ORGANISATION_MANAGER")||this.has(c,"ORGANISATION_OWNER")||this.has(c,"PLATFORM_ADMIN")||this.has(c,"TRAINER"));}
  async canWritePractice(c:SecurityContext,target:UUID){return (await this.inScope(c,target))&&(this.has(c,"LEARNER")||this.has(c,"PROFESSIONAL")||this.has(c,"TRAINER")||this.has(c,"ORGANISATION_OWNER")||this.has(c,"PLATFORM_ADMIN"));}
  async canVerifyCompetency(c:SecurityContext,target:UUID){return (await this.inScope(c,target))&&this.has(c,"TRAINER");}
  private async inScope(c:SecurityContext,target:UUID){return c.organisationId===target||!!c.scopeOrganisationIds?.includes(target)||await this.hierarchy.isDescendantOrSame(target,c.organisationId);}
  private has(c:SecurityContext,r:SecurityRole){return c.roles.includes(r);}
}
export type ProtectedOperation="AUDIT_TELEMETRY"|"WRITE_PRACTICE"|"VERIFY_COMPETENCY";
export class TenantSecurityInterceptor{
  constructor(private readonly policy:SecurityPolicy,private readonly operation:ProtectedOperation,private readonly target:(c:SecurityContext)=>UUID){}
  async intercept<T>(context:SecurityContext,action:()=>Promise<T>):Promise<T>{const org=this.target(context);const allowed=this.operation==="AUDIT_TELEMETRY"?await this.policy.canAuditTelemetry(context,org):this.operation==="WRITE_PRACTICE"?await this.policy.canWritePractice(context,org):await this.policy.canVerifyCompetency(context,org);if(!allowed)throw new AuthorizationError(`Security policy denied ${this.operation} for organisation ${org}.`);return action();}
}
