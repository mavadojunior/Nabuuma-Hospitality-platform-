import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Auth0 Post-Login Action package", () => {
  it("uses namespaced access-token role claim and does not assert organisation authority", async () => {
    const source = await readFile(
      new URL("../deployment/auth0/nabuuma-post-login.js", import.meta.url),
      "utf8",
    );
    expect(source).toContain("api.accessToken.setCustomClaim");
    expect(source).toContain("https://api.nabuuma.com/roles");
    expect(source).toContain("event.authorization.roles");
    expect(source).not.toContain("organisation_id");
    expect(source).not.toContain("organisationId");
    expect(source).not.toContain("api.accessToken.setCustomClaim(\n      \"https://api.nabuuma.com/organisation");
  });
});
