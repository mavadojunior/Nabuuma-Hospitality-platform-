import { UUID } from "../../domain/competency/repositories/contracts.js";
import { CompetencyAuthorizationPort } from "../../application/services/CompetencyTransitionEngine.js";
import { OrganisationHierarchyRepository, TokenClaims } from "./security.js";
export class ClaimsAssessorAuthorizer implements CompetencyAuthorizationPort{
 constructor(private readonly claimsProvider:()=>TokenClaims,private readonly hierarchy:OrganisationHierarchyRepository){}
 async isAuthorizedAssessor(userId:UUID,organisationId:UUID){const c=this.claimsProvider();if(c.subject!==userId)return false;const role=c.roles.includes("TRAINER");if(!role)return false;if(c.organisationId===organisationId)return true;if(c.scopeOrganisationIds?.includes(organisationId))return true;return this.hierarchy.isDescendantOrSame(organisationId,c.organisationId);}
}
