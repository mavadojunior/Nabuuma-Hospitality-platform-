import type {
  RuntimeHealthState,
} from "./interfaces/http/health-routes";

export type RuntimeLifecycleState =
  | "STARTING"
  | "READY"
  | "SHUTTING_DOWN"
  | "STOPPED";

export class RuntimeStateMachine
  implements RuntimeHealthState
{
  private state: RuntimeLifecycleState = "STARTING";

  currentState(): RuntimeLifecycleState {
    return this.state;
  }

  isReady(): boolean {
    return this.state === "READY";
  }

  markReady(): void {
    if (this.state !== "STARTING") {
      throw new Error(
        `Invalid runtime transition: ${this.state} -> READY`,
      );
    }

    this.state = "READY";
  }

  beginShutdown(): void {
    if (
      this.state === "SHUTTING_DOWN" ||
      this.state === "STOPPED"
    ) {
      return;
    }

    this.state = "SHUTTING_DOWN";
  }

  markStopped(): void {
    if (this.state !== "SHUTTING_DOWN") {
      throw new Error(
        `Invalid runtime transition: ${this.state} -> STOPPED`,
      );
    }

    this.state = "STOPPED";
  }
}
