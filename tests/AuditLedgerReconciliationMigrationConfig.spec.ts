import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../db/migrations/00022_reconcile_audit_ledger_architecture.sql", import.meta.url),
  "utf8",
);

describe("audit ledger reconciliation migration 00022", () => {
  it("supports heap conversion and evolved partitioned-state reconciliation", () => {
    expect(migration).toContain("relation_kind = 'p'");
    expect(migration).toContain("relation_kind = 'r'");
    expect(migration).toContain("RANGE (occurred_at)");
  });
  it("proves exact data equality in both directions before heap replacement", () => {
    expect(migration.match(/EXCEPT ALL/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration).toContain("bidirectional row equality failed");
  });
  it("fails closed on incompatible legacy rows and orphan references", () => {
    expect(migration).toContain("rows incompatible with canonical constraints");
    expect(migration).toContain("orphaned organisation/actor references");
    expect(migration).toContain("no values fabricated");
  });
  it("establishes the evidenced composite key, nullable correlation, and required fields", () => {
    expect(migration).toContain("PRIMARY KEY (id, occurred_at)");
    expect(migration).toContain("correlation_id UUID");
    expect(migration).toContain("entity_id UUID NOT NULL");
    expect(migration).toContain("outcome VARCHAR(20) NOT NULL");
  });
  it("enforces tenant RLS and append-only trigger", () => {
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("audit_events_tenant_select");
    expect(migration).toContain("audit_events_tenant_insert");
    expect(migration).toContain("BEFORE UPDATE OR DELETE");
    expect(migration).toContain("ERRCODE = '55000'");
  });
  it("provides monthly partitions and DEFAULT continuity", () => {
    expect(migration).toContain("DATE '2026-10-01'");
    expect(migration).toContain("DATE '2028-10-01'");
    expect(migration).toContain("PARTITION OF nabuuma.audit_events_reconciled DEFAULT");
    expect(migration).toContain("PARTITION OF nabuuma.audit_events DEFAULT");
  });
  it("provides a restricted certificate UUID resolver for non-null audit entity identity", () => {
    expect(migration).toContain("resolve_certificate_id_for_revocation(TEXT)");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("OWNER TO nabuuma_certificate_revoke_owner");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION nabuuma.resolve_certificate_id_for_revocation(TEXT) TO nabuuma_app");
  });
  it("reconciles canonical indexes, foreign keys and policies", () => {
    expect(migration).toContain("audit_events_actor_time_idx");
    expect(migration).toContain("audit_events_correlation_idx");
    expect(migration).toContain("audit_events_entity_time_idx");
    expect(migration).toContain("audit_events_occurred_at_brin_idx");
    expect(migration).toContain("audit_events_org_time_idx");
    expect(migration).toContain("ON DELETE RESTRICT");
  });
  it("is transactional and preserves evolved partitioned table identity", () => {
    expect(migration.startsWith("BEGIN;")).toBe(true);
    expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(migration).toContain("Reconcile in place");
  });
});
