# Operational Readiness Recovery — 2026-11-23

**CONFIDENTIAL — INTERNAL ENGINEERING / SECURITY / RELEASE**

## Evidence status

- Target-specific PostgreSQL 18 clone rehearsal for migrations 00020–00022: VERIFIED.
- Original audit history preservation count/digest/timestamps: VERIFIED in rehearsal.
- Read-only approved-target preflight: VERIFIED today; no target mutation.
- Postcondition manifest: VERIFIED on clone before latest assertion additions; latest assertions statically tested, not clone-executed.
- CI migration order/runtime provisioning: VERIFIED by inspection; runtime role created before migrations.
- CI postcondition manifest invocation: added and statically tested; workflow not executed locally.
- Runtime clone HTTP smoke: NOT EXECUTED (no safe clone-only runtime launcher; production wrapper pins approved port).
- Auth0 operational authority: BLOCKED.
- EAS/mobile build/device callback: BLOCKED.

## Current approved-target baseline

Target reference 127.0.0.1:55433/nabuuma_rls_test, PostgreSQL 18.2. Preflight used explicit BEGIN READ ONLY and ROLLBACK. Identity and server version were returned as metadata. Audit rows=9; logical digest=267ca16fc4a03b6caddba1617d521a1e; min occurred_at=2026-11-11 01:48:39.921593+04; max=2026-11-22 08:47:33.693371+04; partition children=24; DEFAULT=0; invalid=0; orphan=0. Expected migration objects remain absent.

## Release automation

Workflow .github/workflows/release-gate.yml provisions nabuuma_runtime before applying migrations, uses sequential filename checks and psql -v ON_ERROR_STOP=1, runs migrations as CI admin rather than runtime, then grants runtime membership and now executes the read-only postcondition manifest. Three targeted configuration tests passed. Workflow execution itself is NOT EXECUTED.

## Added/updated files

- deployment/sql/approved-db-preflight.sql — fail-closed read-only preflight bound to expected target baseline.
- deployment/sql/approved-db-postconditions.sql — additional runtime-role, PUBLIC verifier EXECUTE, invalid/orphan audit assertions.
- docs/operations/DATABASE-MIGRATION-RUNBOOK.md — operator procedure, backup/restoration prerequisites, stop conditions and rollback semantics.
- .github/workflows/release-gate.yml — postcondition invocation after migrations/grant.
- tests/ApprovedDatabaseOperationalConfig.spec.ts — config/static contract tests.
- docs/operations/OPERATIONAL-READINESS-RECOVERY-2026-11-23.md — this checkpoint.

## Authority and release

REAL_DB_MIGRATION_TECHNICALLY_READY=YES (rehearsal)
REAL_DB_MIGRATION_AUTHORISED=NO
LIVE_AUTH_READY=NO
MOBILE_BUILD_READY=NO
OVERALL_RELEASE_READY=NO
PRODUCTION_RELEASE=NOT AUTHORISED

No approved-target migration, Auth0 mutation, EAS mutation/build, staging, commit, push or tag occurred. The exact next action is external: provide an approved migration identity, change approval/maintenance window and verified backup/restore acknowledgement, then separately approve execution.
