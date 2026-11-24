import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { createRuntimeAuthenticator, createRuntime } from "../src/runtime.js";
import { loadAuthenticationProviderConfig } from "../src/infrastructure/authentication/provider-config.js";
import type { AccessTokenVerifier, VerifiedJwtPayloadVerifier } from "../src/infrastructure/authentication/JoseJwtVerifier.js";

const supabaseEnv = {
  AUTH_PROVIDER: "SUPABASE",
  AUTH_JWT_ISSUER: "https://supabase.example.test/auth/v1",
  AUTH_JWT_AUDIENCE: "api",
  AUTH_JWKS_URI: "https://supabase.example.test/auth/v1/.well-known/jwks.json",
};
const auth0Env = {
  AUTH_PROVIDER: "AUTH0",
  AUTH_JWT_ISSUER: "https://dev-lhgi27ewkdcqtyek.us.auth0.com/",
  AUTH_JWT_AUDIENCE: "https://api.nabuuma.com",
  AUTH_JWKS_URI: "https://dev-lhgi27ewkdcqtyek.us.auth0.com/.well-known/jwks.json",
};
const request = { headers: { authorization: "Bearer synthetic" } } as never;

describe("createRuntime provider composition", () => {
  it("SUPABASE preserves the BearerRequestAuthenticator verifier path without identity repository queries", async () => {
    const verify = vi.fn(async () => ({ subject: "11111111-1111-4111-8111-111111111111", organisationId: "22222222-2222-4222-8222-222222222222", roles: ["LEARNER"] as const }));
    const pool = { query: vi.fn() };
    const authenticator = createRuntimeAuthenticator(loadAuthenticationProviderConfig(supabaseEnv), pool as unknown as Pool, { createVerifier: () => ({ verify } as AccessTokenVerifier) });
    await expect(authenticator.authenticate(request)).resolves.toMatchObject({ subject: "11111111-1111-4111-8111-111111111111" });
    expect(verify).toHaveBeenCalledWith("synthetic");
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("AUTH0 composes verified payload mapping, ExternalIdentityResolver and PgExternalIdentityRepository on the runtime pool", async () => {
    const pool = { query: vi.fn(async (sql: string, params: unknown[]) => {
      expect(sql).toContain("nabuuma.resolve_external_identity");
      expect(params).toEqual(["AUTH0", "auth0|composition-user", null]);
      return { rows: [{ user_id: "11111111-1111-4111-8111-111111111111", organisation_id: "22222222-2222-4222-8222-222222222222", role: "LEARNER" }] };
    }) };
    const verifyPayload = vi.fn(async () => ({ issuer: "https://dev-lhgi27ewkdcqtyek.us.auth0.com/", subject: "auth0|composition-user", audience: "https://api.nabuuma.com", issuedAt: 1, expiresAt: 2, rawClaims: { sub: "auth0|composition-user", "https://api.nabuuma.com/roles": ["LEARNER"] } }));
    const authenticator = createRuntimeAuthenticator(loadAuthenticationProviderConfig(auth0Env), pool as unknown as Pool, { createAuth0Verifier: () => ({ verifyPayload } as VerifiedJwtPayloadVerifier) });
    await expect(authenticator.authenticate(request)).resolves.toMatchObject({ subject: "11111111-1111-4111-8111-111111111111", organisationId: "22222222-2222-4222-8222-222222222222", roles: ["LEARNER"] });
    expect(verifyPayload).toHaveBeenCalledWith("synthetic");
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it("never falls back between provider verifiers after selection", async () => {
    const supabaseVerify = vi.fn(async () => { throw new Error("invalid Supabase token"); });
    const auth0Verify = vi.fn();
    const authenticator = createRuntimeAuthenticator(loadAuthenticationProviderConfig(supabaseEnv), { query: vi.fn() } as unknown as Pool, { createVerifier: () => ({ verify: supabaseVerify } as AccessTokenVerifier), createAuth0Verifier: () => ({ verifyPayload: auth0Verify } as VerifiedJwtPayloadVerifier) });
    await expect(authenticator.authenticate(request)).rejects.toThrow();
    expect(supabaseVerify).toHaveBeenCalledOnce();
    expect(auth0Verify).not.toHaveBeenCalled();
  });
});

  it("documents SUPABASE as the backwards-compatible provider default when AUTH_PROVIDER is omitted", () => {
    const config = loadAuthenticationProviderConfig({
      AUTH_JWT_ISSUER: "https://supabase.example.test/auth/v1",
      AUTH_JWT_AUDIENCE: "api",
      AUTH_JWKS_URI: "https://supabase.example.test/auth/v1/.well-known/jwks.json",
    });
    expect(config.provider).toBe("SUPABASE");
  });


describe("createRuntime startup provider selection", () => {
  function poolFixture() {
    return {
      connect: vi.fn(async () => ({
        query: vi.fn(async () => ({ rows: [{ ready: 1 }] })),
        release: vi.fn(),
      })),
      query: vi.fn(),
    };
  }

  it("starts SUPABASE runtime using its verifier factory", async () => {
    const pool = poolFixture();
    const createVerifier = vi.fn(() => ({ verify: vi.fn(async () => ({ subject: "11111111-1111-4111-8111-111111111111", organisationId: "22222222-2222-4222-8222-222222222222", roles: ["LEARNER"] as const })) }));
    const runtime = await createRuntime({ ...supabaseEnv, HOST: "127.0.0.1", PORT: "3000" }, { initializePool: () => pool as never, closePool: async () => {}, createVerifier });
    try {
      expect(createVerifier).toHaveBeenCalledOnce();
      expect(pool.connect).toHaveBeenCalledOnce();
      expect((await runtime.app.inject({ method: "GET", url: "/health/live" })).statusCode).toBe(200);
    } finally { await runtime.lifecycle.shutdown(); }
  });

  it("starts AUTH0 runtime using its verified-payload verifier factory", async () => {
    const pool = poolFixture();
    const createAuth0Verifier = vi.fn(() => ({ verifyPayload: vi.fn(async () => ({ issuer: "https://dev-lhgi27ewkdcqtyek.us.auth0.com/", subject: "auth0|startup", audience: "https://api.nabuuma.com", issuedAt: 1, expiresAt: 2, rawClaims: { sub: "auth0|startup" } })) }));
    const runtime = await createRuntime({ ...auth0Env, HOST: "127.0.0.1", PORT: "3000" }, { initializePool: () => pool as never, closePool: async () => {}, createAuth0Verifier });
    try {
      expect(createAuth0Verifier).toHaveBeenCalledOnce();
      expect(pool.connect).toHaveBeenCalledOnce();
      expect((await runtime.app.inject({ method: "GET", url: "/health/live" })).statusCode).toBe(200);
    } finally { await runtime.lifecycle.shutdown(); }
  });
});
