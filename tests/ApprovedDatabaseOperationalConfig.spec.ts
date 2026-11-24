import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const preflight = readFileSync(new URL("../deployment/sql/approved-db-preflight.sql", import.meta.url), "utf8");
const postconditions = readFileSync(new URL("../deployment/sql/approved-db-postconditions.sql", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../.github/workflows/release-gate.yml", import.meta.url), "utf8");

describe("approved database operational contracts", () => {
  it("preflight is explicitly read-only, fail-closed, and baseline-bound", () => {
    expect(preflight).toMatch(/BEGIN READ ONLY/);
    expect(preflight).toContain("current_setting('transaction_read_only') <> 'on'");
    expect(preflight).toContain("current_database() <> 'nabuuma_rls_test'");
    expect(preflight).toContain("audit_rows <> 9");
    expect(preflight).toContain("267ca16fc4a03b6caddba1617d521a1e");
    expect(preflight).toContain("partition_count <> 24 OR default_count <> 0");
    expect(preflight).toContain("ROLLBACK;");
    expect(preflight).not.toMatch(/\b(CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
  });
  it("postconditions include certificate, identity, audit integrity, and security assertions", () => {
    expect(postconditions).toContain("00020 PUBLIC verifier EXECUTE granted");
    expect(postconditions).toContain("00021 PUBLIC resolver EXECUTE granted");
    expect(postconditions).toContain("00022 PUBLIC resolver EXECUTE granted");
    expect(postconditions).toContain("audit_invalid_rows");
    expect(postconditions).toContain("audit_orphan_rows");
    expect(postconditions).toContain("FORCE RLS");
  });
  it("CI provisions runtime before migrations and executes postconditions after migration/grants", () => {
    const runtimeProvision = workflow.indexOf("Provision constrained runtime login before migrations");
    const migrationApply = workflow.indexOf("Apply canonical migrations");
    const runtimeGrant = workflow.indexOf("Grant constrained runtime application role");
    const manifest = workflow.indexOf("Execute approved database postconditions");
    expect(runtimeProvision).toBeGreaterThan(-1);
    expect(runtimeProvision).toBeLessThan(migrationApply);
    expect(migrationApply).toBeLessThan(runtimeGrant);
    expect(runtimeGrant).toBeLessThan(manifest);
    expect(workflow.slice(manifest, manifest + 500)).toContain("ON_ERROR_STOP=1");
    expect(workflow.slice(manifest, manifest + 500)).toContain("approved-db-postconditions.sql");
  });
});
