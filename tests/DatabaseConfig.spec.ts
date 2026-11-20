import {
  describe,
  expect,
  it,
} from "vitest";
import {
  parseDatabaseConfig,
} from "../src/infrastructure/database/connection";

const validEnvironment = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/nabuuma",
};

describe("parseDatabaseConfig", () => {
  it("uses validated defaults", () => {
    const config = parseDatabaseConfig(validEnvironment);

    expect(config.max).toBe(20);
    expect(config.idleTimeoutMillis).toBe(30000);
    expect(config.connectionTimeoutMillis).toBe(5000);
    expect(config.allowExitOnIdle).toBe(false);
  });

  it("accepts valid integer overrides", () => {
    const config = parseDatabaseConfig({
      ...validEnvironment,
      DB_MAX_CONNECTIONS: "8",
      DB_IDLE_TIMEOUT_MS: "45000",
      DB_CONNECTION_TIMEOUT_MS: "12000",
    });

    expect(config.max).toBe(8);
    expect(config.idleTimeoutMillis).toBe(45000);
    expect(config.connectionTimeoutMillis).toBe(12000);
  });

  it.each([
    ["DB_MAX_CONNECTIONS", "8abc"],
    ["DB_MAX_CONNECTIONS", "2.5"],
    ["DB_MAX_CONNECTIONS", "0"],
    ["DB_IDLE_TIMEOUT_MS", "999"],
    ["DB_IDLE_TIMEOUT_MS", "30000ms"],
    ["DB_CONNECTION_TIMEOUT_MS", "70000"],
    ["DB_CONNECTION_TIMEOUT_MS", "5000.0"],
  ])("rejects invalid %s value %s", (name, value) => {
    expect(() =>
      parseDatabaseConfig({
        ...validEnvironment,
        [name]: value,
      }),
    ).toThrow();
  });

  it("rejects missing and malformed database URLs", () => {
    expect(() => parseDatabaseConfig({})).toThrow(
      "DATABASE_URL environment variable is required.",
    );
    expect(() =>
      parseDatabaseConfig({
        DATABASE_URL: "not-a-url",
      }),
    ).toThrow("DATABASE_URL must be a valid URL.");
  });

  it("rejects non-PostgreSQL protocols", () => {
    expect(() =>
      parseDatabaseConfig({
        DATABASE_URL: "https://example.com",
      }),
    ).toThrow(
      "DATABASE_URL must use the postgres or postgresql protocol.",
    );
  });
});
