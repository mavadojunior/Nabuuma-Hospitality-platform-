import { UUID } from "../../domain/competency/repositories/contracts";
import { AuthorizationError } from "../../application/services/errors";
export type SecurityRole="LEARNER"|"PROFESSIONAL"|"TRAINER"|"ORGANISATION_MANAGER"|"ORGANISATION_OWNER"|"PLATFORM_ADMIN";
export interface TokenClaims{subject:UUID;roles:readonly SecurityRole[];organisationId:UUID;scopeOrganisationIds?:readonly UUID[];}
export interface OrganisationNode{id:UUID;parentId?:UUID;level:"ENTERPRISE"|"REGION"|"VENUE"|"TEAM";}
export interface OrganisationHierarchyRepository{getNode(id:UUID):Promise<OrganisationNode|null>;isDescendantOrSame(nodeId:UUID,ancestorId:UUID):Promise<boolean>;}
export interface SecurityContext{claims:TokenClaims;}
export interface SecurityPolicy{canAuditTelemetry(c:SecurityContext,target:UUID):Promise<boolean>;canWritePractice(c:SecurityContext,target:UUID):Promise<boolean>;canVerifyCompetency(c:SecurityContext,target:UUID):Promise<boolean>;}

export class TenantRbacPolicy implements SecurityPolicy{
  constructor(private readonly hierarchy:OrganisationHierarchyRepository){}
  async canAuditTelemetry(c:SecurityContext,target:UUID){return (await this.inScope(c,target))&&(this.has(c,"ORGANISATION_MANAGER")||this.has(c,"ORGANISATION_OWNER")||this.has(c,"PLATFORM_ADMIN")||this.has(c,"TRAINER"));}
  async canWritePractice(c:SecurityContext,target:UUID){return (await this.inScope(c,target))&&(this.has(c,"LEARNER")||this.has(c,"PROFESSIONAL")||this.has(c,"TRAINER")||this.has(c,"ORGANISATION_OWNER")||this.has(c,"PLATFORM_ADMIN"));}
  async canVerifyCompetency(c:SecurityContext,target:UUID){return (await this.inScope(c,target))&&this.has(c,"TRAINER");}
  private async inScope(c:SecurityContext,target:UUID){return c.claims.organisationId===target||!!c.claims.scopeOrganisationIds?.includes(target)||await this.hierarchy.isDescendantOrSame(target,c.claims.organisationId);}
  private has(c:SecurityContext,r:SecurityRole){return c.claims.roles.includes(r);}
}
export type ProtectedOperation="AUDIT_TELEMETRY"|"WRITE_PRACTICE"|"VERIFY_COMPETENCY";
export class TenantSecurityInterceptor{
  constructor(private readonly policy:SecurityPolicy,private readonly operation:ProtectedOperation,private readonly target:(c:SecurityContext)=>UUID){}
  async intercept<T>(context:SecurityContext,action:()=>Promise<T>):Promise<T>{const org=this.target(context);const allowed=this.operation==="AUDIT_TELEMETRY"?await this.policy.canAuditTelemetry(context,org):this.operation==="WRITE_PRACTICE"?await this.policy.canWritePractice(context,org):await this.policy.canVerifyCompetency(context,org);if(!allowed)throw new AuthorizationError(`Security policy denied ${this.operation} for organisation ${org}.`);return action();}
}
