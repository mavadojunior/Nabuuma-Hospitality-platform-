import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { JoseJwtVerifier } from "../src/infrastructure/authentication/JoseJwtVerifier.js";
import { Auth0RequestAuthenticator } from "../src/infrastructure/authentication/Auth0RequestAuthenticator.js";
import { ExternalIdentityResolver, type ExternalIdentityRepository, type ActiveMembership } from "../src/infrastructure/authentication/external-identity.js";
import { AuthenticationError } from "../src/infrastructure/authentication/errors.js";

const issuer = "https://dev-lhgi27ewkdcqtyek.us.auth0.com/";
const audience = "https://api.nabuuma.com";
const namespace = "https://api.nabuuma.com";
const userA = "11111111-1111-4111-8111-111111111111";
const orgA = "22222222-2222-4222-8222-222222222222";
const orgB = "33333333-3333-4333-8333-333333333333";
const subjectA = "auth0|synthetic-user-a";

class SyntheticRepository implements ExternalIdentityRepository {
  async resolveIdentity(provider: "AUTH0" | "SUPABASE", subject: string, requested?: string) {
    if (provider !== "AUTH0" || subject !== subjectA) return null;
    const memberships: ActiveMembership[] = [
      { organisationId: orgA, persistenceRole: "LEARNER", active: true },
    ];
    const selected = requested ? memberships.find(m => m.organisationId === requested) : memberships[0];
    return selected ? { userId: userA, membership: selected } : null;
  }
}

async function harness() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const kid = "nabuuma-auth0-synthetic-kid";
  const keySet: JWTVerifyGetKey = async (header) => {
    if (header.kid !== kid) throw new Error("unknown kid");
    return publicKey;
  };
  const verifier = new JoseJwtVerifier({
    issuer, audience, jwksUri: "https://synthetic.invalid/jwks",
    algorithms: ["RS256"],
  }, keySet);
  const resolver = new ExternalIdentityResolver(new SyntheticRepository());
  const authenticator = new Auth0RequestAuthenticator(verifier, resolver);
  const app = Fastify({ logger: false });
  app.get("/protected", async (request, reply) => {
    try {
      const claims = await authenticator.authenticate(request);
      return reply.code(200).send({ subject: claims.subject, organisationId: claims.organisationId, roles: claims.roles });
    } catch (error) {
      return reply.code(error instanceof AuthenticationError ? 401 : 500).send({ error: "authentication_failed" });
    }
  });
  await app.ready();

  const token = async (overrides: {
    iss?: string; aud?: string; sub?: string | null; exp?: number; kid?: string;
    organisation?: string; roles?: unknown; signer?: typeof privateKey;
  } = {}) => {
    const now = Math.floor(Date.now()/1000);
    const claims: Record<string, unknown> = {};
    if (overrides.organisation !== undefined) claims[namespace + "/organisation_id"] = overrides.organisation;
    if (overrides.roles !== undefined) claims[namespace + "/roles"] = overrides.roles;
    let jwt = new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: overrides.kid ?? kid })
      .setIssuer(overrides.iss ?? issuer)
      .setAudience(overrides.aud ?? audience);
    if (Object.prototype.hasOwnProperty.call(overrides, "sub")) {
      if (overrides.sub !== null && overrides.sub !== undefined) jwt = jwt.setSubject(overrides.sub);
    } else jwt = jwt.setSubject(subjectA);
    jwt = jwt.setIssuedAt(now).setExpirationTime(overrides.exp ?? now + 120);
    return jwt.sign(overrides.signer ?? privateKey);
  };
  return { app, token, privateKey };
}

describe("Auth0 provider-specific HTTP composition", () => {
  it("accepts signed opaque Auth0 subject and resolves internal UUID + DB tenant/role", async () => {
    const h = await harness();
    try {
      const response = await h.app.inject({ method: "GET", url: "/protected", headers: { authorization: "Bearer " + await h.token() } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ subject: userA, organisationId: orgA, roles: ["LEARNER"] });
      expect(response.json().subject).not.toBe(subjectA);
    } finally { await h.app.close(); }
  });

  it.each([
    ["TARGET_CONFIG_SUPABASE_REJECTION", { iss: "https://mzfkamgfvxypakfkjdfs.supabase.co/auth/v1" }],
    ["wrong audience", { aud: "not-the-api" }],
    ["expired", { exp: 1 }],
    ["unknown KID", { kid: "untrusted-kid" }],
    ["missing subject", { sub: null }],
    ["unknown identity", { sub: "auth0|unknown-user" }],
    ["cross-tenant", { organisation: orgB }],
    ["role elevation", { roles: ["PLATFORM_ADMIN"] }],
    ["malformed organisation", { organisation: "not-a-uuid" }],
    ["malformed roles", { roles: "PLATFORM_ADMIN" }],
  ])("rejects %s at HTTP boundary", async (_name, overrides) => {
    const h = await harness();
    try {
      const response = await h.app.inject({ method: "GET", url: "/protected", headers: { authorization: "Bearer " + await h.token(overrides) } });
      expect(response.statusCode).toBe(401);
    } finally { await h.app.close(); }
  });

  it("rejects a valid token signed by an untrusted key", async () => {
    const h = await harness();
    const attacker = (await generateKeyPair("RS256")).privateKey;
    try {
      const response = await h.app.inject({ method: "GET", url: "/protected", headers: { authorization: "Bearer " + await h.token({ signer: attacker }) } });
      expect(response.statusCode).toBe(401);
    } finally { await h.app.close(); }
  });
});
