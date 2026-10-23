export interface JwtAuthenticationConfig {
  readonly issuer: string;
  readonly audience: string;
  readonly jwksUri: string;
  readonly algorithms: readonly string[];
}

function requiredEnvironmentVariable(
  environment: NodeJS.ProcessEnv,
  name: string,
): string {
  const value = environment[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function validHttpsUrl(value: string, name: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }

  if (url.protocol !== "https:") {
    throw new Error(`${name} must use HTTPS.`);
  }

  return url.toString();
}

export function loadJwtAuthenticationConfig(
  environment: NodeJS.ProcessEnv = process.env,
): JwtAuthenticationConfig {
  const issuer = validHttpsUrl(
    requiredEnvironmentVariable(environment, "AUTH_JWT_ISSUER"),
    "AUTH_JWT_ISSUER",
  );

  const audience = requiredEnvironmentVariable(
    environment,
    "AUTH_JWT_AUDIENCE",
  );

  const jwksUri = validHttpsUrl(
    requiredEnvironmentVariable(environment, "AUTH_JWKS_URI"),
    "AUTH_JWKS_URI",
  );

  return {
    issuer: issuer.replace(/\/$/, ""),
    audience,
    jwksUri,
    algorithms: ["RS256", "ES256"],
  };
}
