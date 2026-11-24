import { describe, expect, it } from "vitest";
import {
  AuthenticationError,
  ExternalIdentityResolver,
  PgExternalIdentityRepository,
  mapVerifiedAuth0Payload,
  type ActiveMembership,
  type ExternalIdentityRepository,
} from "../src/infrastructure/authentication/index.js";

const userId = "11111111-1111-4111-8111-111111111111";
const organisationId = "22222222-2222-4222-8222-222222222222";
const otherOrganisationId = "33333333-3333-4333-8333-333333333333";
const opaqueSubject = "auth0|opaque-subject-42";
const namespace = "https://api.nabuuma.com";

class FixtureRepository implements ExternalIdentityRepository {
  user: string | null = userId;
  memberships: readonly ActiveMembership[] = [{
    organisationId, persistenceRole: "LEARNER", active: true,
  }];
  async resolveIdentity(provider: "AUTH0" | "SUPABASE", subject: string, requestedOrganisationId?: string) {
    expect(provider).toBe("AUTH0");
    expect(subject).toBe(opaqueSubject);
    if (!this.user) return null;
    const active = this.memberships.filter((m) => m.active);
    if (requestedOrganisationId) {
      const membership = active.find((m) => m.organisationId === requestedOrganisationId);
      return membership ? { userId: this.user, membership } : null;
    }
    if (active.length !== 1) return null;
    return { userId: this.user, membership: active[0]! };
  }
}

describe("Auth0 external identity contract", () => {
  it("accepts opaque Auth0 subjects without UUID parsing", () => {
    expect(mapVerifiedAuth0Payload({
      sub: opaqueSubject,
      [`${namespace}/organisation_id`]: organisationId,
      [`${namespace}/roles`]: ["LEARNER"],
    })).toEqual({
      provider: "AUTH0",
      externalSubject: opaqueSubject,
      requestedOrganisationId: organisationId,
      assertedRoles: ["LEARNER"],
    });
  });

  it.each([
    { sub: "", reason: "empty subject" },
    { sub: "auth0|x", [`${namespace}/organisation_id`]: "not-a-uuid", reason: "malformed tenant claim" },
    { sub: "auth0|x", [`${namespace}/roles`]: [], reason: "empty roles" },
    { sub: "auth0|x", [`${namespace}/roles`]: ["ROOT"], reason: "unsupported role" },
    { sub: "auth0|x", [`${namespace}/roles`]: "LEARNER", reason: "roles not an array" },
  ])("rejects $reason", (payload) => {
    expect(() => mapVerifiedAuth0Payload(payload)).toThrow(AuthenticationError);
  });
});

describe("ExternalIdentityResolver", () => {
  it("maps an opaque external subject to internal UUID and DB-authoritative membership", async () => {
    const resolver = new ExternalIdentityResolver(new FixtureRepository());
    await expect(resolver.resolve({
      provider: "AUTH0", externalSubject: opaqueSubject,
      requestedOrganisationId: organisationId, assertedRoles: ["LEARNER"],
    })).resolves.toEqual({ subject: userId, organisationId, roles: ["LEARNER"] });
  });

  it("rejects unknown external identities", async () => {
    const repo = new FixtureRepository(); repo.user = null;
    await expect(new ExternalIdentityResolver(repo).resolve({
      provider: "AUTH0", externalSubject: opaqueSubject,
    })).rejects.toThrow(AuthenticationError);
  });

  it("selects the sole active membership when organisation is omitted", async () => {
    const resolver = new ExternalIdentityResolver(new FixtureRepository());
    await expect(resolver.resolve({ provider: "AUTH0", externalSubject: opaqueSubject }))
      .resolves.toEqual({ subject: userId, organisationId, roles: ["LEARNER"] });
  });

  it("rejects zero active memberships", async () => {
    const repo = new FixtureRepository(); repo.memberships = [];
    await expect(new ExternalIdentityResolver(repo).resolve({
      provider: "AUTH0", externalSubject: opaqueSubject,
    })).rejects.toThrow(AuthenticationError);
  });

  it("selects a requested organisation among multiple active memberships", async () => {
    const repo = new FixtureRepository();
    repo.memberships = [
      { organisationId, persistenceRole: "LEARNER", active: true },
      { organisationId: otherOrganisationId, persistenceRole: "MANAGER", active: true },
    ];
    await expect(new ExternalIdentityResolver(repo).resolve({
      provider: "AUTH0", externalSubject: opaqueSubject,
      requestedOrganisationId: otherOrganisationId, assertedRoles: ["ORGANISATION_MANAGER"],
    })).resolves.toEqual({ subject: userId, organisationId: otherOrganisationId, roles: ["ORGANISATION_MANAGER"] });
  });

  it("rejects an explicitly requested inactive/nonmember organisation", async () => {
    const repo = new FixtureRepository();
    repo.memberships = [{ organisationId, persistenceRole: "LEARNER", active: true }];
    await expect(new ExternalIdentityResolver(repo).resolve({
      provider: "AUTH0", externalSubject: opaqueSubject,
      requestedOrganisationId: otherOrganisationId,
    })).rejects.toThrow(AuthenticationError);
  });

  it("rejects inactive membership", async () => {
    const repo = new FixtureRepository();
    repo.memberships = [{ organisationId, persistenceRole: "LEARNER", active: false }];
    await expect(new ExternalIdentityResolver(repo).resolve({
      provider: "AUTH0", externalSubject: opaqueSubject,
    })).rejects.toThrow(AuthenticationError);
  });

  it("rejects ambiguous active membership without explicit selection model", async () => {
    const repo = new FixtureRepository();
    repo.memberships = [
      { organisationId, persistenceRole: "LEARNER", active: true },
      { organisationId: otherOrganisationId, persistenceRole: "LEARNER", active: true },
    ];
    await expect(new ExternalIdentityResolver(repo).resolve({
      provider: "AUTH0", externalSubject: opaqueSubject,
    })).rejects.toThrow(AuthenticationError);
  });

  it("rejects tenant claim that disagrees with DB membership", async () => {
    await expect(new ExternalIdentityResolver(new FixtureRepository()).resolve({
      provider: "AUTH0", externalSubject: opaqueSubject,
      requestedOrganisationId: otherOrganisationId,
    })).rejects.toThrow(AuthenticationError);
  });

  it("rejects asserted roles that disagree with DB membership", async () => {
    await expect(new ExternalIdentityResolver(new FixtureRepository()).resolve({
      provider: "AUTH0", externalSubject: opaqueSubject, assertedRoles: ["TRAINER"],
    })).rejects.toThrow(AuthenticationError);
  });

  it("rejects invalid internal user identifiers returned by repository", async () => {
    const repo = new FixtureRepository(); repo.user = "auth0|not-a-uuid";
    await expect(new ExternalIdentityResolver(repo).resolve({
      provider: "AUTH0", externalSubject: opaqueSubject,
    })).rejects.toThrow(AuthenticationError);
  });
});


describe("PgExternalIdentityRepository SQL boundary", () => {
  it("calls the restricted pre-transaction resolver with parameterized values", async () => {
    const query = async (sql: string, values?: unknown[]) => {
      expect(sql).toContain("nabuuma.resolve_external_identity");
      expect(sql).not.toContain("nabuuma.external_identities");
      expect(values).toEqual(["AUTH0", opaqueSubject, organisationId]);
      return { rows: [{ user_id: userId, organisation_id: organisationId, role: "LEARNER" }] };
    };
    const repo = new PgExternalIdentityRepository({ query } as never);
    await expect(repo.resolveIdentity("AUTH0", opaqueSubject, organisationId)).resolves.toEqual({
      userId,
      membership: { organisationId, persistenceRole: "LEARNER", active: true },
    });
  });

  it("maps resolver no-row to unknown or unauthorized identity", async () => {
    const query = async () => ({ rows: [] });
    const repo = new PgExternalIdentityRepository({ query } as never);
    await expect(repo.resolveIdentity("AUTH0", opaqueSubject)).resolves.toBeNull();
  });

  it("rejects unexpected multiple rows from resolver", async () => {
    const query = async () => ({ rows: [
      { user_id: userId, organisation_id: organisationId, role: "LEARNER" },
      { user_id: userId, organisation_id: otherOrganisationId, role: "MANAGER" },
    ] });
    const repo = new PgExternalIdentityRepository({ query } as never);
    await expect(repo.resolveIdentity("AUTH0", opaqueSubject)).rejects.toThrow(AuthenticationError);
  });
});
