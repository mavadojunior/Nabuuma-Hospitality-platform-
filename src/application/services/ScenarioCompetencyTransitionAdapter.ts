import type {
  CompetencyTransitionPort,
} from "../../domain/practice/engine/types";
import type { CompetencyTransitionEngine } from "./CompetencyTransitionEngine";

export class ScenarioCompetencyTransitionAdapter
  implements CompetencyTransitionPort
{
  constructor(
    private readonly competency: CompetencyTransitionEngine,
  ) {}

  async transition(input: {
    learnerCompetencyId: string;
    actorId: string;
    targetState: "PRACTICE" | "DEMONSTRATION";
    scenarioId: string;
    evidenceId?: string;
  }): Promise<void> {
    await this.competency.transition({
      learnerCompetencyId: input.learnerCompetencyId,
      actorId: input.actorId,
      nextState: input.targetState,
    });
  }
}
