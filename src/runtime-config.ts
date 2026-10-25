export interface RuntimeConfig {
  readonly host: string;
  readonly port: number;
  readonly shutdownTimeoutMs: number;
}

function integer(
  value: string,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (!/^[0-9]+$/.test(value)) {
    throw new Error(`${name} must be an integer.`);
  }

  const parsed = Number(value);

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new Error(
      `${name} must be between ${minimum} and ${maximum}.`,
    );
  }

  return parsed;
}

export function loadRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  const host = environment.HOST?.trim() || "0.0.0.0";

  return {
    host,
    port: integer(
      environment.PORT?.trim() || "3000",
      "PORT",
      1,
      65535,
    ),
    shutdownTimeoutMs: integer(
      environment.SHUTDOWN_TIMEOUT_MS?.trim() || "30000",
      "SHUTDOWN_TIMEOUT_MS",
      1000,
      120000,
    ),
  };
}
