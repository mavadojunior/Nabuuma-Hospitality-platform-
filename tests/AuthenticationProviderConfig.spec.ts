import { describe, expect, it } from "vitest";
import { loadAuthenticationProviderConfig } from "../src/infrastructure/authentication/provider-config.js";

const auth0 = {
  AUTH_PROVIDER: "AUTH0",
  AUTH_JWT_ISSUER: "https://dev-lhgi27ewkdcqtyek.us.auth0.com/",
  AUTH_JWT_AUDIENCE: "https://api.nabuuma.com",
  AUTH_JWKS_URI: "https://dev-lhgi27ewkdcqtyek.us.auth0.com/.well-known/jwks.json",
};

describe("authentication provider configuration", () => {
  it("selects the existing Supabase path explicitly", () => {
    expect(loadAuthenticationProviderConfig({
      AUTH_PROVIDER: "SUPABASE",
      AUTH_JWT_ISSUER: "https://supabase.example.test/auth/v1",
      AUTH_JWT_AUDIENCE: "api",
      AUTH_JWKS_URI: "https://supabase.example.test/auth/v1/.well-known/jwks.json",
    }).provider).toBe("SUPABASE");
  });
  it("selects Auth0 and target issuer/audience/JWKS configuration", () => {
    const config = loadAuthenticationProviderConfig(auth0);
    expect(config.provider).toBe("AUTH0");
    expect(config.jwt).toEqual({
      issuer: "https://dev-lhgi27ewkdcqtyek.us.auth0.com",
      audience: "https://api.nabuuma.com",
      jwksUri: "https://dev-lhgi27ewkdcqtyek.us.auth0.com/.well-known/jwks.json",
      algorithms: ["RS256", "ES256"],
    });
  });
  it("fails closed for unknown provider", () => {
    expect(() => loadAuthenticationProviderConfig({ ...auth0, AUTH_PROVIDER: "BOTH" })).toThrow("AUTH_PROVIDER must be SUPABASE or AUTH0");
  });
  it.each(["AUTH_JWT_ISSUER", "AUTH_JWT_AUDIENCE", "AUTH_JWKS_URI"])("fails closed when Auth0 config %s is missing", (key) => {
    const environment = { ...auth0 };
    delete environment[key as keyof typeof environment];
    expect(() => loadAuthenticationProviderConfig(environment)).toThrow(`${key} is required`);
  });
  it("does not default provider to Auth0", () => {
    expect(() => loadAuthenticationProviderConfig({})).toThrow("AUTH_JWT_ISSUER is required");
  });
});

it("fails closed for missing Supabase JWT configuration", () => {
  expect(() => loadAuthenticationProviderConfig({ AUTH_PROVIDER: "SUPABASE" })).toThrow("AUTH_JWT_ISSUER is required");
});
