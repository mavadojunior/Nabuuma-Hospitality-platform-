# Controlled deployment preflight — 2026-11-23

## Mode and boundaries

Read-only operational preflight. No migration, role grant, Auth0 mutation, EAS project/environment mutation, build, production release, commit, push or tag executed.

## Worktree drift

### Backend
- Branch: `feat/academy-enrolment-certificate-hardening`.
- Modified tracked source/config/tests and untracked migrations 00020–00022, deployment, docs, scripts, Auth0 source/tests remain as the previously verified engineering checkpoint.
- Additional operational documentation is expected: operational cutover runbook, approved-DB postcondition SQL, evidence checkpoint, secret-scan evidence, and this preflight.
- `git diff --check`: PASS.
- No tracked `.env` or `.env.local`.
- No PGDATA, PostgreSQL config, recovery-copy or PEM/key files found within project tree.
- Root `recovery/` is ignored by `.gitignore`, exists locally with dated Nov 11 recovery artifacts, and was not inspected or changed. It is not tracked or promoted.
- No build/recovery artifact promoted into source.

### Mobile
- Branch: `master`.
- Previously verified mobile changes remain: App.tsx, app.json, package-lock.json, package.json, .gitignore and untracked .github, RELEASE-HANDOFF.md, eas.json, scripts and src.
- `git diff --check`: PASS.
- No tracked `.env` or `.env.local`.
- No PGDATA, PostgreSQL config, recovery-copy or PEM/key files found in project tree.
- No build artifacts were promoted.

## Approved DB read-only baseline

Target reference: `127.0.0.1:55433/nabuuma_rls_test`.

- Socket: accepting connections.
- Server: PostgreSQL 18.2 (aarch64 Android).
- Current connection identity: `u0_a427`.
- Current identity catalog attributes: SUPERUSER, CREATEDB, CREATEROLE, LOGIN, INHERIT, BYPASSRLS. This is the local cluster operator identity, not a separately supplied/approved migration identity. All preflight SQL ran in explicit `BEGIN READ ONLY` transactions and ended with ROLLBACK.
- No migration ledger table discovered (`nabuuma.schema_migrations` absent). Migration state is catalog-equivalence only.
- Database read baseline available; migration authority and change approval are NOT granted by the connection identity.

### Migration-equivalence catalogue

| Migration | Read-only result | Classification |
|---|---|---|
| 00019 certificate revocation authority | Restricted non-login owner exists with safe role attributes; revocation function owner is that role, SECURITY DEFINER, search_path pg_catalog; app EXECUTE true, runtime EXECUTE false; revocation RLS policies and immutable trigger exist; exact column grants verified | APPLIED_EQUIVALENT for inspected 00019 security boundary |
| 00020 runtime verification grant | Runtime schema USAGE false; verifier EXECUTE false; direct certificate SELECT false; verifier-role membership false; verifier owner/security/search_path hardened | REQUIRED |
| 00021 external identity authority | external_identities absent; resolver absent; membership owner is nabuuma_auth_owner, non-FORCE RLS boundary; runtime direct membership SELECT false | REQUIRED |
| 00022 audit reconciliation | Audit parent is partitioned RANGE(occurred_at); composite PK (id, occurred_at); id default gen_random_uuid(); correlation_id nullable; entity_id/outcome NOT NULL; canonical 2 RESTRICT FKs; 6 canonical indexes; RLS/FORCE RLS; 2 canonical tenant policies; append-only trigger; 24 monthly partitions (2026-10 through 2028-09); no DEFAULT partition; 9 audit rows; invalid rows=0, orphan rows=0, unexpected policies=0, unexpected triggers=0, inbound FKs=0; certificate UUID resolver absent | INCOMPLETE / REQUIRED postconditions |

Migration 00022 should be reviewed against the evolved partitioned branch; that branch is expected to add the DEFAULT partition and resolver while preserving the existing partitioned relation/history. No migration was executed. Audit row count is baseline only; preservation is not yet proven across a migration.

## Authority matrix

| Authority | Availability |
|---|---|
| DATABASE_READ | AVAILABLE — read-only transaction |
| DATABASE_MIGRATION | BLOCKED — no separately supplied migration identity/change approval; local default identity is superuser but not authorised for mutation |
| AUTH0_READ | BLOCKED — no current administrative connector/access |
| AUTH0_MUTATE | BLOCKED — no administrative authority and no live cutover approval |
| EAS_READ | BLOCKED — EAS CLI reports Not logged in; no project link |
| EAS_MUTATE | BLOCKED — unauthenticated/project authority absent |
| PRODUCTION_RELEASE | NOT_APPROVED |

## Auth0 preflight

Admin tenant state not inspectable. No Auth0 administrative tool/credential was explicitly supplied. Static source evidence remains locked: expected issuer `https://dev-lhgi27ewkdcqtyek.us.auth0.com/`, audience `https://api.nabuuma.com`, RS256, JWKS endpoint, role namespace `https://api.nabuuma.com/roles`. Mobile identity is `scheme=nabuuma`, Android package and iOS bundle ID `com.nabuuma.app`. This is source/config evidence, not tenant verification.

## EAS preflight

- One `npx eas-cli@latest whoami` check: `Not logged in`.
- `.eas/project.json`: absent.
- Static app config: slug `nabuuma-mobile`, owner unset, projectId unset, scheme `nabuuma`, Android package `com.nabuuma.app`, iOS bundle ID `com.nabuuma.app`.
- Development profile: development client, internal distribution, Android APK, environment development.
- Remote EAS environment inventory unavailable. No login retry, project link, environment mutation or build performed.

## Change plans

### Plan A — approved DB
1. Change approval and maintenance window.
2. Protected recovery checkpoint and restore validation.
3. Read-only catalogue baseline (this preflight is not a substitute for an operator-owned backup).
4. Determine per-migration equivalence.
5. Apply only required forward migrations in ordinal order, transactional and stop-on-error.
6. Execute `deployment/sql/approved-db-postconditions.sql`.
7. Compare audit preservation against baseline; verify 9-row baseline and complete row-content preservation.
8. Verify privilege canaries.
9. Restart canonical runtime if approved.
10. Health, UNKNOWN, VALID, REVOKED canaries.
11. Stop and use approved recovery plan on critical failure.

### Plan B — Auth0
No cutover authority. After DB postconditions, controlled identity mapping, tenant/API/Action/callback read and approval, backup runtime config; switch AUTH_PROVIDER only under separate change approval; canary wrong issuer/audience, malformed/expired, old Supabase, unknown subject, role elevation, cross-tenant and certificate states; rollback on critical failure.

### Plan C — EAS development
After authenticated owner authority, verify intended owner/project; review project linkage; configure public development variables; build internal development APK only; record artifact integrity; install and canary login/callback/course/tenant isolation. No production/store build.

## Git / release control

- Backend and mobile worktrees remain uncommitted.
- Diff checks pass.
- No staging, commit, push, tag, migration, live cutover, EAS mutation, build or production deployment.
- Commit/push preparation must include changed-file inventories, migrations, tests, secret evidence, docs and release-note summary; do not stage until explicit approval.

## EXACT NEXT ACTION

`WAIT_FOR_EXTERNAL_AUTHORITY`.

Priority request: explicit approved DB migration identity plus change approval/maintenance window and operator-owned recovery checkpoint. Once those are supplied, review the catalogue baseline and request separate explicit execution approval for Plan A. No other autonomous project is substituted.
