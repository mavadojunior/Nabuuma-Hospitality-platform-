export interface AuthHookConfig {
  readonly secret: string;
}

export function loadAuthHookConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AuthHookConfig {
  const secret =
    environment
      .SUPABASE_AUTH_HOOK_SECRET
      ?.trim();

  if (!secret) {
    throw new Error(
      "SUPABASE_AUTH_HOOK_SECRET is required.",
    );
  }

  return {
    secret,
  };
}
