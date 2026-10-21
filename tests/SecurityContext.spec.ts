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
    const context = createSecurityContext(validClaims, "33333333-3333-4333-8333-333333333333");

    expect(context).toEqual({
      userId: "user-123",
      organisationId: "org-456",
      roles: ["TRAINER"],
      scopeOrganisationIds: ["org-789"],
      correlationId: "33333333-3333-4333-8333-333333333333",
    });
  });

  it("freezes the context and its arrays at runtime", () => {
    const context = createSecurityContext(validClaims, "33333333-3333-4333-8333-333333333333");

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

    const context = createSecurityContext(claims, "33333333-3333-4333-8333-333333333333");
    roles.push("LEARNER");
    scopes.push("org-999");

    expect(context.roles).toEqual(["TRAINER"]);
    expect(context.scopeOrganisationIds).toEqual(["org-789"]);
  });

  it("rejects a missing subject", () => {
    expect(() =>
      createSecurityContext(
        { ...validClaims, subject: "" },
        "33333333-3333-4333-8333-333333333333",
      ),
    ).toThrow("Verified claims must include a subject.");
  });

  it("rejects a missing organisation", () => {
    expect(() =>
      createSecurityContext(
        { ...validClaims, organisationId: "" },
        "33333333-3333-4333-8333-333333333333",
      ),
    ).toThrow("Verified claims must include an organisation.");
  });

  it("rejects missing roles", () => {
    expect(() =>
      createSecurityContext(
        { ...validClaims, roles: [] },
        "33333333-3333-4333-8333-333333333333",
      ),
    ).toThrow("Verified claims must include at least one role.");
  });

  it("rejects a missing correlation ID", () => {
    expect(() =>
      createSecurityContext(validClaims, " "),
    ).toThrow("A correlation ID is required.");
  });


  it("rejects a non-UUID correlation ID", () => {
    expect(() =>
      createSecurityContext(validClaims, "request-abc"),
    ).toThrow("A correlation ID must be a valid UUID.");
  });

  it("rejects an unsupported role", () => {
    const claims = {
      ...validClaims,
      roles: ["HACKER" as never],
    };

    expect(() =>
      createSecurityContext(claims, "33333333-3333-4333-8333-333333333333"),
    ).toThrow("Verified claims contain an unsupported role.");
  });

  it("rejects an empty organisation scope entry", () => {
    const claims: TokenClaims = {
      ...validClaims,
      scopeOrganisationIds: ["org-789", " "],
    };

    expect(() =>
      createSecurityContext(claims, "33333333-3333-4333-8333-333333333333"),
    ).toThrow("Verified claims contain an invalid organisation scope.");
  });
});
