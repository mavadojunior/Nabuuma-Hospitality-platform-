import {
  describe,
  expect,
  it,
} from "vitest";
import {
  loadAuthHookConfig,
} from "../src/infrastructure/authentication/auth-hook-config";

describe("loadAuthHookConfig", () => {
  it("loads and trims the configured secret", () => {
    expect(
      loadAuthHookConfig({
        SUPABASE_AUTH_HOOK_SECRET:
          "  whsec_test_secret  ",
      }),
    ).toEqual({
      secret: "whsec_test_secret",
    });
  });

  it("rejects a missing hook secret", () => {
    expect(() =>
      loadAuthHookConfig({}),
    ).toThrow(
      "SUPABASE_AUTH_HOOK_SECRET is required.",
    );
  });

  it("rejects an empty hook secret", () => {
    expect(() =>
      loadAuthHookConfig({
        SUPABASE_AUTH_HOOK_SECRET: "   ",
      }),
    ).toThrow(
      "SUPABASE_AUTH_HOOK_SECRET is required.",
    );
  });
});
