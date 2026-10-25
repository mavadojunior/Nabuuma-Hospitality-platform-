import {
  describe,
  expect,
  it,
} from "vitest";
import {
  loadRuntimeConfig,
} from "../src/runtime-config";

describe("loadRuntimeConfig", () => {
  it("uses production-safe runtime defaults", () => {
    expect(
      loadRuntimeConfig({}),
    ).toEqual({
      host: "0.0.0.0",
      port: 3000,
      shutdownTimeoutMs: 30000,
    });
  });

  it("loads explicit runtime configuration", () => {
    expect(
      loadRuntimeConfig({
        HOST: "127.0.0.1",
        PORT: "8080",
        SHUTDOWN_TIMEOUT_MS: "45000",
      }),
    ).toEqual({
      host: "127.0.0.1",
      port: 8080,
      shutdownTimeoutMs: 45000,
    });
  });

  it("rejects an invalid port", () => {
    expect(() =>
      loadRuntimeConfig({
        PORT: "65536",
      }),
    ).toThrow("PORT must be between");
  });

  it("rejects an invalid shutdown timeout", () => {
    expect(() =>
      loadRuntimeConfig({
        SHUTDOWN_TIMEOUT_MS: "999",
      }),
    ).toThrow(
      "SHUTDOWN_TIMEOUT_MS must be between",
    );
  });
});
