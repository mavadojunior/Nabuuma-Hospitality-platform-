# Nabuuma operational cutover readiness

## Authority boundary

Preparation only. This package authorises no approved-target database mutation, private runtime configuration change, live Auth0 deployment/cutover, production deployment, or production/mobile-store release.

Current target reference (not an authority grant): `127.0.0.1:55433/nabuuma_rls_test`. Never use the private runtime environment as a migration credential source and never print credential-bearing URLs.

## Locked isolated engineering evidence

- Source migration lineage 00001–00022.
- Isolated migration replay/reconciliation verified.
- 00022 audit reconciliation verified in isolated PostgreSQL; partitioned branch preserves the evolved partitioned relation and validates catalogue/data conditions. Heap conversion checks bidirectional `EXCEPT ALL` before transactional replacement.
- Auth0 source composition and Auth0 HTTP-to-PostgreSQL verified.
- Academy learner E2E 16/16, zero skipped.
- Zero-skip release regression 302/302, zero failed, zero skipped.
- `npm run verify:release` PASS.
- Auth0 Action static/config test 1/1 PASS.
- Mobile source verification after final client hardening is recorded in the final checkpoint.
- Isolated evidence is not live-target or production evidence.

## Approved DB migration runbook — future authorised operator

### Preconditions

1. Obtain explicit migration/change authority and a maintenance window.
2. Obtain migration credentials through an approved secure mechanism; do not use runtime credentials.
3. Verify host, port, database, current user and PostgreSQL version before any write.
4. Create a protected backup/recovery checkpoint. Record path, timestamp, size, checksum and successful restore validation in the change record.
5. Do not mutate a production or approved target unless separately authorised. This readiness task performs no migration.

### Read-only baseline

```sql
SELECT current_database(), current_user, version();
SELECT n.nspname, c.relname, c.relkind, c.reltuples::bigint AS estimate,
       pg_get_partkeydef(c.oid) AS partition_key,
       c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='nabuuma' AND c.relname IN
  ('audit_events','external_identities','academy_certificates',
   'academy_certificate_revocations','organisation_memberships')
ORDER BY c.relname;
SELECT p.oid::regprocedure, pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef, p.proconfig
FROM pg_proc p WHERE p.oid IN (
  'nabuuma.verify_academy_certificate(text)'::regprocedure,
  'nabuuma.resolve_external_identity(text,text,uuid)'::regprocedure,
  'nabuuma.resolve_certificate_id_for_revocation(text)'::regprocedure
);
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies WHERE schemaname='nabuuma' ORDER BY tablename, policyname;
SELECT parent.relname AS parent, child.relname AS child,
       pg_get_expr(child.relpartbound,child.oid) AS bound
FROM pg_inherits i JOIN pg_class parent ON parent.oid=i.inhparent
JOIN pg_class child ON child.oid=i.inhrelid
JOIN pg_namespace n ON n.oid=parent.relnamespace
WHERE n.nspname='nabuuma' AND parent.relname='audit_events'
ORDER BY child.relname;
```

### Migration equivalence decision

The repository has no authoritative migration ledger; determine applied-equivalence from catalogue and migration-specific postconditions, not ordinal presence alone. Record each migration `APPLIED_EQUIVALENT`, `REQUIRED`, or `INCOMPLETE/UNKNOWN`.

- **00020:** if verifier ownership, SECURITY DEFINER, hardened search path, runtime EXECUTE/schema USAGE and direct-table/membership boundaries already match, skip. Otherwise apply only after compatibility review.
- **00021:** if `external_identities` constraints, owner, RLS, resolver ownership/security/search path, ACL and runtime direct-read denials match, skip. If absent, apply. If partial/incompatible, stop for reconciliation; do not blindly rerun `CREATE TABLE`.
- **00022:** inspect `audit_events.relkind` and partition catalog. If canonical partitioned state and resolver are already equivalent, skip. Existing partitioned state follows the migration’s reconciliation branch. Heap conversion follows the migration’s transactional copy, bidirectional `EXCEPT ALL` proof and swap. Any invalid row, orphan, unexpected trigger/policy/FK or failed equality aborts. Never destroy evolved partition history to imitate clean replay.
- Apply only required forward migrations in ordinal order, individually, using `psql -X -v ON_ERROR_STOP=1 -f`. Each migration is transaction-wrapped. Do not invent migration-history rows.
- Keep passwords out of command arguments, shell history, logs, documentation and Git.

### Postconditions

Execute `deployment/sql/approved-db-postconditions.sql` with the approved migration identity after applying the reviewed migrations. It is read-only and raises an exception on any failed postcondition. Capture its result in the change record.

### Runtime restart and canary

Only under separate approval: restart the canonical runtime from the protected configuration source; verify liveness/readiness, provider selection, protected Academy endpoint, tenant isolation, role-elevation rejection, and public certificate verification for UNKNOWN/controlled VALID/controlled REVOKED. Critical failure triggers stop and approved restore/rollback. Do not improvise destructive rollback for append-only audit data.

## Auth0 controlled cutover — prepared, not executed

### Preconditions

- Approved DB migrations and postcondition manifest PASS.
- External identity resolver operational.
- Controlled user mapping provisioned; resolver returns exactly one expected internal UUID, tenant and DB-derived role.
- Auth0 Native application callback/logout URLs verified for exact mobile scheme/environment.
- API audience `https://api.nabuuma.com`, RS256, issuer `https://dev-lhgi27ewkdcqtyek.us.auth0.com/`.
- Post-Login Action deployed to correct tenant/API and tested. It emits namespaced roles from `event.authorization.roles`; it must not claim organisation membership or embed secrets.
- Secure backup of previous runtime provider config outside Git.

### Configuration switch

In the authorised private config set `AUTH_PROVIDER=AUTH0`, `AUTH_JWT_ISSUER=https://dev-lhgi27ewkdcqtyek.us.auth0.com/`, `AUTH_JWT_AUDIENCE=https://api.nabuuma.com`, and `AUTH_JWKS_URI=https://dev-lhgi27ewkdcqtyek.us.auth0.com/.well-known/jwks.json`. Validate syntax, file owner/mode and target before restart. This task does not change runtime config.

### Canary matrix

| Check | Expected |
|---|---|
| `/health/live` | success |
| `/health/ready` | success |
| Valid Auth0 token for linked subject, protected Academy route | success |
| Unknown subject | 401 |
| Wrong audience/issuer, malformed or expired token | 401 |
| Supabase token under AUTH0 provider | 401 |
| Tenant A requesting Tenant B resource | denied/invisible |
| Role claim elevated above persisted DB role | 401 |
| Public verification UNKNOWN | privacy-safe non-500 |
| Controlled certificate VALID | VALID |
| Controlled revoked certificate | REVOKED |

Any critical canary failure: stop cutover; restore protected prior provider config; validate ownership/mode; restart canonically; verify health, restored-provider authenticated canary and public verifier. Redact tokens from logs.

## Identity provisioning — prepared, not executed

1. Verify the real Auth0 `sub` from a cryptographically verified token. It is opaque text, provider-qualified and limited to 255 characters.
2. Verify internal user UUID exists and target organisation membership is active.
3. Confirm persisted role is supported. `ASSESSOR` maps to app `TRAINER`; `CONTENT_EDITOR` is currently unsupported for Auth0 login.
4. Insert provider `AUTH0`, subject and internal user UUID using parameterised SQL. Never store organisation, role, permission or token authority in the identity mapping.
5. On unique conflict, do not auto-reassign. Verify existing mapping belongs to the same user or stop for authorised reconciliation.
6. Call restricted resolver with explicit organisation for multi-membership; assert exactly one row and expected UUID, tenant and role.
7. Commit only after all assertions. No live identity rows are inserted during readiness.

## Auth0 rollback

Prior provider config remains securely backed up outside Git. Under cutover authority: stop runtime; restore backup; validate ownership/mode; restart; verify liveness/readiness, restored-provider auth canary and public certificate verification. Do not reproduce private values here or rotate/deploy Auth0 resources without separate authority.

## EAS / mobile development build

`npx eas-cli@latest whoami` returned `Not logged in`; no credential retries or project mutations were made.

Public bundle variables: `EXPO_PUBLIC_AUTH0_DOMAIN`, `EXPO_PUBLIC_AUTH0_AUDIENCE`, `EXPO_PUBLIC_AUTH0_CLIENT_ID`, `EXPO_PUBLIC_NABUUMA_API_BASE_URL`. They are public identifiers/URLs, not secrets. Ignored local `.env.local` is not a remote EAS build input; configure the four values in the appropriate EAS environment after authority is supplied.

Target owner/project: `nabuuma/nabuuma-mobile`. After authenticated whoami, inspect `npx eas-cli@latest project:info`; confirm linkage before any init/link operation. Development profile is internal Android APK, `developmentClient=true`, `distribution=internal`, `android.buildType=apk`, `environment=development`. Build development only. No production/store artifact.

After authorised development build, install on test device and record install, launch, Auth0 login, callback, Academy course request, TLS/base URL and cross-tenant denial. Remote artifact is not installed-device acceptance.

## Authority checkpoint

| Operation | State |
|---|---|
| Migration authority | `BLOCKED_EXTERNAL_AUTHORITY` |
| Auth0 admin authority | `BLOCKED_EXTERNAL_AUTHORITY` (no current admin connector/credential supplied) |
| EAS authority | `BLOCKED_EXTERNAL_AUTHORITY` (`whoami` unauthenticated) |
| Approved DB migration | `NOT_EXECUTED` |
| Live Auth0 deployment/cutover | `NOT_EXECUTED` |
| EAS development APK | `NOT_EXECUTED` |
| Production release | `BLOCKED_EXPLICIT_APPROVAL` |

No commits, pushes, tags, production deployment, runtime config changes, approved-target DB mutations or live Auth0 mutations were performed.
