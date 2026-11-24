import { loadJwtAuthenticationConfig, type JwtAuthenticationConfig } from "./config.js";

export type AuthenticationProvider = "SUPABASE" | "AUTH0";

export interface AuthenticationProviderConfig {
  readonly provider: AuthenticationProvider;
  readonly jwt: JwtAuthenticationConfig;
}

export function loadAuthenticationProviderConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AuthenticationProviderConfig {
  const raw = environment.AUTH_PROVIDER?.trim() || "SUPABASE";
  if (raw !== "SUPABASE" && raw !== "AUTH0") {
    throw new Error("AUTH_PROVIDER must be SUPABASE or AUTH0.");
  }
  return { provider: raw, jwt: loadJwtAuthenticationConfig(environment) };
}
