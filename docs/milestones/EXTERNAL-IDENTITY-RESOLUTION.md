# External Identity Resolution — PostgreSQL Authority Milestone

## Scope

Provider-neutral external identity mapping and pre-transaction organisation membership resolution. Live Auth0 cutover and runtime configuration were not changed.

## Evidence

- PostgreSQL 18.2 isolated prototype, port 55447, canonical migrations 00001–00020.
- PostgreSQL 18.2 clean replay, port 55448, canonical migrations 00001–00021.
- Migration 00021: `db/migrations/00021_external_identity_resolution_authority.sql`.
- Identity table: provider-qualified subject uniqueness; opaque TEXT subject; UUID internal-user FK; provider CHECK; nonblank and 255-character checks; no provider/user uniqueness constraint.
- Resolver: restricted `SECURITY DEFINER`, owner `nabuuma_auth_owner`, `search_path=pg_catalog`, PUBLIC EXECUTE revoked, runtime EXECUTE granted.
- External identity table ENABLE/FORCE RLS with resolver-owner SELECT policy.
- Canonical membership table owner `nabuuma_auth_owner`, RLS enabled, FORCE disabled as verified by migration 00014/00015/00021 postconditions.
- Runtime direct identity SELECT, direct membership SELECT, and SET ROLE resolver-owner denied. Runtime SUPERUSER/BYPASSRLS false; owner SUPERUSER/BYPASSRLS false; runtime owner membership false.
- Synthetic DB matrix and live `PgExternalIdentityRepository` integration passed.
- `ExternalIdentityResolver` returned internal UUID, database-derived organisation and role; unknown, inactive, ambiguous, cross-tenant and unsupported role rejected.
- `PgTransactionManager` set internal UUID and tenant context; tenant-scoped course query returned tenant A and denied tenant B; COMMIT and ROLLBACK context reset verified.
- Clean replay 00001–00021 succeeded with ON_ERROR_STOP=1.
- CI release gate includes the PostgreSQL identity integration script after runtime role/app membership provisioning.

## Test evidence

- PostgreSQL external identity integration: 29 assertions passed, 0 failed, 0 skipped.
- Targeted application/authentication tests: 53 passed, 0 failed, 0 skipped.
- Full backend suite: 33 files passed, 9 skipped; 220 tests passed, 46 skipped, 0 failed. DB-dependent legacy tests were intentionally not run against port 55433.
- Typecheck, build, ESM verification (70 modules / 94 relative imports), and `git diff --check`: passed.

## Remaining blockers

- Synthetic Auth0 JWT through full HTTP authentication composition: NOT EXECUTED.
- Live Auth0 issuer/audience/JWKS runtime cutover: NOT EXECUTED.
- Supabase JWT rejection after cutover: NOT EXECUTED.
- Deterministic Supabase identity backfill: not implemented; existing state preserved.
- Certificate migration 00020 on approved target: BLOCKED.
- Audit-ledger reconciliation: BLOCKED / not altered.
- Expo Simulator/EAS account linkage: BLOCKED by unavailable credentials/project linkage.

## Next safe action

Implement and test synthetic Auth0 JWT composition in an isolated test composition using the verified PostgreSQL identity resolver. Do not alter runtime.env or Auth0 tenant configuration.
