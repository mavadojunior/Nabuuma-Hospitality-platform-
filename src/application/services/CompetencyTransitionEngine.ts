import { AssessmentRepository, CompetencyRepository, EvidenceRepository, LearnerCompetency, UUID } from "../../domain/competency/repositories/contracts";
import { AuthorizationError, InvalidCompetencyTransitionError, VerificationRequiredError } from "./errors";
export interface CompetencyAuthorizationPort { isAuthorizedAssessor(userId:UUID,organisationId:UUID):Promise<boolean>; }
export interface CompetencyTransaction { run<T>(work:()=>Promise<T>):Promise<T>; }

export class CompetencyTransitionEngine {
  constructor(private readonly competencies:CompetencyRepository,private readonly assessments:AssessmentRepository,private readonly evidence:EvidenceRepository,private readonly authorization:CompetencyAuthorizationPort,private readonly transaction:CompetencyTransaction) {}
  async transition(input:{learnerCompetencyId:UUID;actorId:UUID;nextState:LearnerCompetency["state"];assessmentId?:UUID;verifiedById?:UUID;evidenceId?:UUID;}):Promise<LearnerCompetency>{
    return this.transaction.run(async()=>{
      const current=await this.competencies.getLearnerCompetency(input.learnerCompetencyId);
      if(!current) throw new InvalidCompetencyTransitionError("UNKNOWN",input.nextState);
      if(!this.isAllowed(current.state,input.nextState)) throw new InvalidCompetencyTransitionError(current.state,input.nextState);
      if(input.nextState!=="VERIFIED_COMPETENCY") return this.competencies.transitionState(current.id,input.nextState,input.actorId);
      if(!input.assessmentId||!input.verifiedById||!input.evidenceId) throw new VerificationRequiredError();
      if(input.actorId!==input.verifiedById) throw new AuthorizationError("The actor verifying competency must be the recorded assessor.");
      if(!(await this.authorization.isAuthorizedAssessor(input.verifiedById,current.organisationId))) throw new AuthorizationError("Assessor is not authorized for this organisation.");
      const assessment=await this.assessments.getById(input.assessmentId);
      if(!assessment||assessment.learnerCompetencyId!==current.id||assessment.assessorId!==input.verifiedById||assessment.result!=="VERIFIED") throw new VerificationRequiredError("Assessment is missing, belongs to another competency, has another assessor, or is not VERIFIED.");
      const evidence=await this.evidence.getById(input.evidenceId);
      if(!evidence||evidence.id!==assessment.evidenceId||evidence.practiceSessionId===undefined) throw new VerificationRequiredError("The VERIFIED assessment must reference a valid linked EvidenceRecord.");
      return this.competencies.transitionState(current.id,"VERIFIED_COMPETENCY",input.actorId,{assessmentId:input.assessmentId,verifiedById:input.verifiedById});
    });
  }
  private isAllowed(from:LearnerCompetency["state"],to:LearnerCompetency["state"]):boolean{return(from==="EXPOSURE"&&to==="PRACTICE")||(from==="PRACTICE"&&to==="DEMONSTRATION")||(from==="DEMONSTRATION"&&to==="VERIFIED_COMPETENCY");}
}
