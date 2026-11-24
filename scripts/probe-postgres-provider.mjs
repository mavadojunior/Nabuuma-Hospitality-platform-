#!/usr/bin/env node
import pg from "pg";
import fs from "node:fs/promises";

const url = process.env.DATABASE_URL;
if (!url || process.env.NABUUMA_DISPOSABLE_TARGET !== "YES") {
  console.error("Refusing: DATABASE_URL and explicit disposable-target acknowledgement are required.");
  process.exit(2);
}
let parsed;
try { parsed = new URL(url); } catch { console.error("Invalid DATABASE_URL"); process.exit(2); }
if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !/(test|probe|disposable|sandbox|drill)/i.test(decodeURIComponent(parsed.pathname))) {
  console.error("Refusing: PostgreSQL URL database name must identify test/probe/disposable/sandbox/drill.");
  process.exit(2);
}
const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 7000, statement_timeout: 10000 });
const checks = [];
const add = (name, status, details = "") => checks.push({ name, status, details });
try {
  await client.connect();
  const identity = await client.query("SELECT current_database() AS db, current_user AS role, version() AS version, current_setting('server_version_num') AS version_num");
  const server = identity.rows[0];
  add("postgres_version", Number(server.version_num) >= 160000 ? "PASS" : "FAIL", server.version);
  await client.query("BEGIN");
  try {
    await client.query("SAVEPOINT nabuuma_probe");
    await client.query("SET LOCAL nabuuma.probe_setting = 'portable'");
    const setting = await client.query("SELECT current_setting('nabuuma.probe_setting', true) AS v");
    add("custom_settings", setting.rows[0].v === "portable" ? "PASS" : "FAIL", "Custom GUC transaction-local set/read");

    await client.query("CREATE SCHEMA nabuuma_probe_tmp");
    await client.query("CREATE TABLE nabuuma_probe_tmp.rls_probe (id integer primary key, owner_name text) PARTITION BY RANGE (id)");
    await client.query("CREATE TABLE nabuuma_probe_tmp.rls_probe_0 PARTITION OF nabuuma_probe_tmp.rls_probe FOR VALUES FROM (0) TO (10)");
    await client.query("ALTER TABLE nabuuma_probe_tmp.rls_probe ENABLE ROW LEVEL SECURITY");
    await client.query("ALTER TABLE nabuuma_probe_tmp.rls_probe FORCE ROW LEVEL SECURITY");
    await client.query("CREATE POLICY probe_policy ON nabuuma_probe_tmp.rls_probe USING (owner_name = current_user)");
    const rel = await client.query("SELECT relrowsecurity, relforcerowsecurity, relkind FROM pg_class WHERE oid='nabuuma_probe_tmp.rls_probe'::regclass");
    const policies = await client.query("SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='nabuuma_probe_tmp' AND tablename='rls_probe'");
    add("rls", rel.rows[0].relrowsecurity ? "PASS" : "FAIL", "ENABLE RLS");
    add("force_rls", rel.rows[0].relforcerowsecurity ? "PASS" : "FAIL", "FORCE RLS");
    add("partitioning", rel.rows[0].relkind === "p" ? "PASS" : "FAIL", "Partitioned parent plus child");
    add("policies", policies.rows[0].n === 1 ? "PASS" : "FAIL", "Policy catalog");

    await client.query("CREATE FUNCTION nabuuma_probe_tmp.definer_probe() RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT current_user $$");
    const fn = await client.query("SELECT prosecdef, pg_get_userbyid(proowner) AS owner, proconfig FROM pg_proc WHERE oid='nabuuma_probe_tmp.definer_probe()'::regprocedure");
    add("security_definer", fn.rows[0].prosecdef && fn.rows[0].proconfig?.includes("search_path=pg_catalog") ? "PASS" : "FAIL", "SECURITY DEFINER and pinned search_path");
    await client.query("REVOKE ALL ON FUNCTION nabuuma_probe_tmp.definer_probe() FROM PUBLIC");
    const publicExec = await client.query("SELECT has_function_privilege('public', 'nabuuma_probe_tmp.definer_probe()', 'EXECUTE') AS ok");
    add("restricted_function_execution", publicExec.rows[0].ok === false ? "PASS" : "FAIL", "PUBLIC EXECUTE revoked");

    const privileges = await client.query("SELECT has_schema_privilege(current_user, 'nabuuma_probe_tmp', 'USAGE') AS usage, has_schema_privilege(current_user, 'nabuuma_probe_tmp', 'CREATE') AS create");
    add("schema_privileges", privileges.rows[0].usage && privileges.rows[0].create ? "PASS" : "FAIL", "Current role schema USAGE/CREATE");
    const extension = await client.query("SELECT EXISTS(SELECT 1 FROM pg_available_extensions WHERE name='pgcrypto') AS available, EXISTS(SELECT 1 FROM pg_extension WHERE extname='pgcrypto') AS installed");
    add("pgcrypto_available", extension.rows[0].available ? "PASS" : "FAIL", "Required extension availability");
    add("pgcrypto_installed", extension.rows[0].installed ? "PASS" : "UNKNOWN", "Probe does not install extensions");
    const roles = await client.query("SELECT rolname, rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls FROM pg_roles WHERE rolname IN ('nabuuma_app','nabuuma_runtime','nabuuma_auth_owner','nabuuma_certificate_revoke_owner') ORDER BY rolname");
    const roleNames = new Set(roles.rows.map(r => r.rolname));
    for (const name of ["nabuuma_app", "nabuuma_runtime", "nabuuma_auth_owner", "nabuuma_certificate_revoke_owner"]) {
      add("role_" + name, roleNames.has(name) ? "PASS" : "UNKNOWN", roleNames.has(name) ? JSON.stringify(roles.rows.find(r => r.rolname === name)) : "Not provisioned in this target");
    }
    if (roleNames.has("nabuuma_app")) {
      try { await client.query("SET LOCAL ROLE nabuuma_app"); await client.query("RESET ROLE"); add("set_role_nabuuma_app", "PASS", "SET ROLE succeeded"); }
      catch (e) { add("set_role_nabuuma_app", "FAIL", e.message); }
    } else add("set_role_nabuuma_app", "UNKNOWN", "Role absent");

    add("transactions", "PASS", "BEGIN/SAVEPOINT/ROLLBACK supported");
    await client.query("ROLLBACK TO SAVEPOINT nabuuma_probe");
  } finally {
    await client.query("ROLLBACK");
  }
  const required = ["postgres_version","custom_settings","rls","force_rls","partitioning","policies","security_definer","restricted_function_execution","schema_privileges","pgcrypto_available","transactions"];
  const hasFail = checks.some(c => c.status === "FAIL");
  const hasUnknown = checks.some(c => c.status === "UNKNOWN");
  const result = { probe_version: 1, timestamp_utc: new Date().toISOString(), target: { database: server.db, role: server.role }, postgres_version_num: Number(server.version_num), required_version: "16+", required_checks: required, checks, overall: hasFail ? "FAIL" : hasUnknown ? "INCOMPLETE" : "PASS" };
  const out = JSON.stringify(result, null, 2);
  if (process.env.PROBE_JSON) await fs.writeFile(process.env.PROBE_JSON, out + "\n", { flag: "wx", mode: 0o600 });
  console.log(out);
  process.exitCode = hasFail ? 1 : hasUnknown ? 3 : 0;
} catch (e) {
  console.error(JSON.stringify({ overall: "FAIL", error: e.message, checks }, null, 2));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
