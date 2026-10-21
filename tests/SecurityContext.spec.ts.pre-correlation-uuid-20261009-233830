import { describe, expect, it } from "vitest";
import {
  createSecurityContext,
  type TokenClaims,
} from "../src/infrastructure/security/security";

describe("createSecurityContext", () => {
  const validClaims: TokenClaims = {
    subject: "user-123",
    organisationId: "org-456",
    roles: ["TRAINER"],
    scopeOrganisationIds: ["org-789"],
  };

  it("copies identity, roles, scopes, and correlation ID", () => {
    const context = createSecurityContext(validClaims, "request-abc");

    expect(context).toEqual({
      userId: "user-123",
      organisationId: "org-456",
      roles: ["TRAINER"],
      scopeOrganisationIds: ["org-789"],
      correlationId: "request-abc",
    });
  });

  it("freezes the context and its arrays at runtime", () => {
    const context = createSecurityContext(validClaims, "request-abc");

    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.roles)).toBe(true);
    expect(Object.isFrozen(context.scopeOrganisationIds)).toBe(true);
  });

  it("does not retain mutable references to the original arrays", () => {
    const roles: TokenClaims["roles"] extends readonly (infer R)[] ? R[] : never =
      ["TRAINER"];
    const scopes = ["org-789"];
    const claims: TokenClaims = {
      subject: "user-123",
      organisationId: "org-456",
      roles,
      scopeOrganisationIds: scopes,
    };

    const context = createSecurityContext(claims, "request-abc");
    roles.push("LEARNER");
    scopes.push("org-999");

    expect(context.roles).toEqual(["TRAINER"]);
    expect(context.scopeOrganisationIds).toEqual(["org-789"]);
  });

  it("rejects a missing subject", () => {
    expect(() =>
      createSecurityContext(
        { ...validClaims, subject: "" },
        "request-abc",
      ),
    ).toThrow("Verified claims must include a subject.");
  });

  it("rejects a missing organisation", () => {
    expect(() =>
      createSecurityContext(
        { ...validClaims, organisationId: "" },
        "request-abc",
      ),
    ).toThrow("Verified claims must include an organisation.");
  });

  it("rejects missing roles", () => {
    expect(() =>
      createSecurityContext(
        { ...validClaims, roles: [] },
        "request-abc",
      ),
    ).toThrow("Verified claims must include at least one role.");
  });

  it("rejects a missing correlation ID", () => {
    expect(() =>
      createSecurityContext(validClaims, " "),
    ).toThrow("A correlation ID is required.");
  });

  it("rejects an unsupported role", () => {
    const claims = {
      ...validClaims,
      roles: ["HACKER" as never],
    };

    expect(() =>
      createSecurityContext(claims, "request-abc"),
    ).toThrow("Verified claims contain an unsupported role.");
  });

  it("rejects an empty organisation scope entry", () => {
    const claims: TokenClaims = {
      ...validClaims,
      scopeOrganisationIds: ["org-789", " "],
    };

    expect(() =>
      createSecurityContext(claims, "request-abc"),
    ).toThrow("Verified claims contain an invalid organisation scope.");
  });
});
