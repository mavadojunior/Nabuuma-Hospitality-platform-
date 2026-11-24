import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
const migration=readFileSync('db/migrations/00021_external_identity_resolution_authority.sql','utf8');
const workflow=readFileSync('.github/workflows/release-gate.yml','utf8');
describe('external identity authority migration configuration',()=>{
 it('defines provider-qualified uniqueness and opaque subject constraints',()=>{
  expect(migration).toContain("CHECK (provider IN ('AUTH0','SUPABASE'))");
  expect(migration).toContain('length(external_subject) <= 255');
  expect(migration).toContain("external_subject ~ '[^[:space:]]'");
  expect(migration).toContain('UNIQUE (provider, external_subject)');
  expect(migration).not.toContain('UNIQUE (provider, user_id)');
 });
 it('hardens resolver and denies runtime direct table reads',()=>{
  expect(migration).toContain('SECURITY DEFINER');
  expect(migration).toContain('SET search_path = pg_catalog');
  expect(migration).toContain('REVOKE ALL');
  expect(migration).toContain('FROM PUBLIC');
  expect(migration).toContain('TO nabuuma_runtime');
  expect(migration).toContain("has_table_privilege('nabuuma_runtime','nabuuma.external_identities','SELECT')");
  expect(migration).toContain("has_table_privilege('nabuuma_runtime','nabuuma.organisation_memberships','SELECT')");
 });
 it('provisions runtime role before migrations and grants app membership after',()=>{
  const provision=workflow.indexOf('Provision constrained runtime login before migrations');
  const apply=workflow.indexOf('Apply canonical migrations');
  const grant=workflow.indexOf('Grant constrained runtime application role');
  expect(provision).toBeGreaterThan(-1);expect(apply).toBeGreaterThan(provision);expect(grant).toBeGreaterThan(apply);
 });
});
