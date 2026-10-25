import {
  describe,
  expect,
  it,
} from "vitest";
import {
  RuntimeStateMachine,
} from "../src/runtime-health-state";

describe("RuntimeStateMachine", () => {
  it("follows the production lifecycle", () => {
    const runtime = new RuntimeStateMachine();

    expect(runtime.currentState()).toBe("STARTING");
    expect(runtime.isReady()).toBe(false);

    runtime.markReady();

    expect(runtime.currentState()).toBe("READY");
    expect(runtime.isReady()).toBe(true);

    runtime.beginShutdown();

    expect(runtime.currentState()).toBe(
      "SHUTTING_DOWN",
    );
    expect(runtime.isReady()).toBe(false);

    runtime.markStopped();

    expect(runtime.currentState()).toBe("STOPPED");
    expect(runtime.isReady()).toBe(false);
  });

  it("makes shutdown initiation idempotent", () => {
    const runtime = new RuntimeStateMachine();

    runtime.markReady();
    runtime.beginShutdown();
    runtime.beginShutdown();

    expect(runtime.currentState()).toBe(
      "SHUTTING_DOWN",
    );
  });

  it("rejects invalid readiness transitions", () => {
    const runtime = new RuntimeStateMachine();

    runtime.beginShutdown();

    expect(() => runtime.markReady()).toThrow(
      "Invalid runtime transition",
    );
  });

  it("rejects stopping before shutdown", () => {
    const runtime = new RuntimeStateMachine();

    expect(() => runtime.markStopped()).toThrow(
      "Invalid runtime transition",
    );
  });
});
