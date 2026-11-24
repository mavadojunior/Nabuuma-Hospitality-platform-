# NABUUMA BOOTSTRAP CLOSURE REPORT — 2026-11-23

Execution mode: controlled closure gate via Desktop Commander.
Repository: `$HOME/Nabuuma-Hospitality-platform-`
Branch: `feat/academy-enrolment-certificate-hardening`
HEAD: `a442300e5002a512064b4ff2e9a7b4fd160aaa00`
Authority: no approved DB mutation, production deployment, cloud provisioning, commit, push, or destructive Git action.

## A. Workspace baseline
- Repository and current branch/HEAD verified.
- Existing modifications and untracked files preserved.
- Approved DB `127.0.0.1:55433/nabuuma_rls_test` reachable as `nabuuma_runtime`, PostgreSQL 18.2.
- 55433 is read-only for this execution.
- Disposable PostgreSQL 18.2 cluster created at port 55436 under private cache.
- Existing repository state was not reset or cleaned.

## B. Files changed during this closure execution
- No repository implementation files changed.
- Disposable cluster and test-report artefacts were created in cache.
- This report is a new dated record; historical resilience report was not overwritten.

## C. 47/49 discrepancy
Read-only relation-name capture:
- Approved 55433: 47 entries.
- Fresh canonical migrations 00001–00022: 49 entries.
- Canonical-only objects: `nabuuma.audit_events_default` and `nabuuma.external_identities`.
- `audit_events_default` is established by migration 00022.
- `external_identities` is established by migration 00021.
- Exact relation identity discrepancy is explained as migration-related; approved catalogue state appears behind canonical migrations.
- Full catalogue equivalence remains unproven because the approved runtime identity cannot inspect all required catalogue attributes.

SCHEMA_47_49_EXPLAINED = PASS (object identities and migration relationship established)
SCHEMA_EQUIVALENCE = FAIL

## D. Approved-vs-canonical schema manifest
- Canonical database created from sequential migrations 00001–00022.
- Canonical Nabuuma relation/partition entries: 49.
- Approved DB: 47.
- Full columns, defaults, constraints, indexes, sequences, owners, ACLs, policies, triggers, functions and extension comparison was not available against 55433.
- No approved DB mutation.

## E. Complete ACL comparison
- Existing manifest captures selected function ACLs and schema ACL but not exhaustive table/sequence privilege equivalence.
- Approved catalogue permissions were insufficient to perform the complete comparison.
- Full table ACL, sequence ACL, ownership, schema ACL, role membership and runtime grant equivalence was not demonstrated.

ACL_EQUIVALENCE = FAIL
ACL_DELTA = NOT ESTABLISHED (required zero; fail closed)

## F. Role-bootstrap recovery
- Fresh disposable PostgreSQL 18.2 cluster initialized.
- Canonical migrations 00001–00022 completed.
- `bootstrap-postgres-roles.sql` executed idempotently.
- Role attributes observed for nabuuma_app, nabuuma_runtime, nabuuma_auth_owner and nabuuma_certificate_revoke_owner: NOLOGIN, NOSUPERUSER, NOCREATEROLE, NOCREATEDB, NOBYPASSRLS.
- Runtime membership in nabuuma_app was granted on disposable cluster.
- Full archive restore into a fresh cluster with post-restore manifest and security-canary comparison was not completed.

ROLE_BOOTSTRAP_RECOVERY = FAIL (role script idempotency passes; full recovery sequence unproven)

## G. Mandatory database/security tests
Standard suite:
- 259 passed
- 0 failed
- 46 skipped
- 305 total

Integration attempt with RUN_RLS_INTEGRATION=1 and disposable DB:
- 259 passed
- 2 failed
- 44 skipped
- 305 total
- Two CertificateVerificationSecurity tests failed because their PG pool lacked a PostgreSQL user in the connection environment.
- 44 conditional DB/security tests remained skipped.
- A corrected PG* environment was attempted through the zero-skip wrapper; wrapper exited 1, but it removed its temporary JSON report, so detailed second-attempt counts are unavailable.
- The wrapper's report cleanup on failure prevents retained diagnostic evidence.

REQUIRED_DB_TESTS_FAILED = 2 (observed retained direct report)
REQUIRED_DB_TESTS_SKIPPED = 44 (observed retained direct report)

## H. Backup/restore
- Historical 2026-11-23 resilience report records a successful earlier backup/restore drill with checksum and selected manifest/canaries.
- A second rehearsal after exhaustive ACL work was NOT completed because exhaustive ACL comparison was not completed.
- This execution did not establish source/restore data digest equality, full structural manifest equality, or full ACL manifest equality.

BACKUP_RESTORE = FAIL (closure repetition incomplete)
DATA_DIGEST = MISMATCH (match not demonstrated; fail-closed encoding)
STRUCTURAL_MANIFEST = MISMATCH (match not demonstrated; canonical/approved discrepancy known)
ACL_MANIFEST = MISMATCH (match not demonstrated)
SECURITY_CANARIES = FAIL (repeat closure canary set not demonstrated)

## I. Container build
Tool detection:
- docker: not installed
- docker buildx: unavailable with docker
- docker compose: unavailable with docker
- podman: not installed
- buildah: not installed
- skopeo: not installed

Dockerfile static inspection:
- Multi-stage Node build/dependency/runtime.
- Lockfile-based npm ci.
- Production-only dependencies in production-dependencies stage.
- Distroless Node 22 runtime.
- nonroot user.
- NODE_ENV=production.
- Node fetch healthcheck syntax is compatible with distroless Node entrypoint; runtime execution not verified.
- Build, image metadata, runtime UID, read-only behavior, SIGTERM, restart and DB-unavailable behavior not executed.

CONTAINER_BUILD = BLOCKED_ENVIRONMENT
CONTAINER_RUNTIME = BLOCKED_ENVIRONMENT

## J. Compose/Caddy
Static inspection:
- API has internal expose 3000, no host-published API port.
- Caddy publishes 80/443.
- API and Caddy share private network.
- Caddy reverse-proxies to api:3000.
- Caddy waits for API health.
- API read-only filesystem, tmpfs, dropped capabilities and no-new-privileges.
- runtime.env is external/private and not committed.
- Compose parser/runtime unavailable; config and runtime startup not executed.

COMPOSE_RUNTIME = BLOCKED_ENVIRONMENT

## K. Image digest pinning
Dockerfile FROM tags:
- node:22-bookworm-slim (dependencies and production dependencies)
- gcr.io/distroless/nodejs22-debian12:nonroot (runtime)

Authoritative digest resolution and image metadata inspection were not performed. No digest was invented or added.

DIGEST_PINNING = BLOCKED

## L. Independent encrypted backup
No approved independent storage target, authorization, encryption-key separation or retrieval credential was available for this test.
No backup was uploaded.

INDEPENDENT_BACKUP_RESTORE = BLOCKED_EXTERNAL_AUTHORITY

## M. Provider capability
Local disposable PostgreSQL provider probe on port 55436:
- PostgreSQL 18.2: PASS
- Transactions/savepoints: PASS
- Custom GUC: PASS
- RLS/FORCE RLS: PASS
- Partitioning/policies: PASS
- SECURITY DEFINER and pinned search_path: PASS
- PUBLIC EXECUTE revocation: PASS
- Schema privileges: PASS
- pgcrypto available/installed: PASS
- Required roles and SET ROLE: PASS
- Overall local probe: PASS

No hosted provider environment or authorized cloud account was tested.

PROVIDER_HOSTED_PROBE = BLOCKED_EXTERNAL_AUTHORITY

## N. Quality gates
PASS:
- typecheck
- production build
- ESM import verification (72 modules / 99 relative imports)
- shell syntax for backup, restore and runtime scripts
- Node syntax for manifest/provider probe/zero-skip gate
- git diff --check
- targeted secret-pattern scan of deployment/backup/probe files (no matches)

Repository-wide test suite is not a zero-skip pass. Container and provider runtime gates remain blocked.

## O. Git integrity
- No commit created.
- No push performed.
- Existing user modifications preserved.
- No destructive Git operation performed.
- No production deployment.
- No approved DB destructive mutation.

## P. Outstanding blockers
1. Full read-only schema catalogue and ACL capture from 55433 requires authorized catalogue-read capability or authorized admin-generated manifest; do not grant privileges or mutate the database during this closure.
2. Exhaustive ACL manifest tooling and comparison.
3. Fresh-cluster role bootstrap → archive restore → complete manifest → security-canary recovery proof.
4. Mandatory database/security test gate: resolve connection environment and retain JSON evidence; execute all required tests with zero skips.
5. Repeat full backup/restore after ACL manifest completion.
6. OCI build/runtime and Compose/Caddy runtime need Docker/Podman-capable environment.
7. Authoritative base-image digests need registry verification.
8. Independent encrypted backup requires approved external storage and separately held key.
9. Hosted provider probe requires an authorized disposable provider database.

## Q. Final verdict
BOOTSTRAP_CLOSURE_READY = NO

The known 47/49 discrepancy is explained, local PostgreSQL capability probe passes, and static engineering checks pass. Mandatory schema/ACL equivalence, full recovery, zero-skip DB/security test execution, container runtime, independent backup and hosted provider gates remain unresolved.
