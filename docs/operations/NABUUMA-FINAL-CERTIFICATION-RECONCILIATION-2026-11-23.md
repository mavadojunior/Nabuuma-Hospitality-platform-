# NABUUMA FINAL CERTIFICATION RECONCILIATION

**Date:** 2026-11-23
**Workspace:** `$HOME/Nabuuma-Hospitality-platform-`
**Branch:** `feat/academy-enrolment-certificate-hardening`
**HEAD observed during reconciliation:** `a442300e5002a512064b4ff2e9a7b4fd160aaa00`
**Mode:** final evidence/report reconciliation; read-only with respect to PostgreSQL and all existing evidence.

## 1. Authority and scope

This report is the current certification-status reconciliation for the 2026-11-23 bootstrap/release/recovery closure. It supersedes interim status statements in earlier operational reports only where this report records a later, specifically identified evidence state. It does not erase or rewrite historical findings, test failures, or earlier execution limitations.

No PostgreSQL connection or mutation was performed during this reconciliation. In particular, port 55433 was not accessed. No tests, migrations, restore operations, role changes, backup operations, process lifecycle actions, commits, pushes, tags, or deployments were performed. Existing working-tree changes and all evidence artefacts were preserved.

## 2. Release certification — current state

| Gate | Current result | Evidence reference |
|---|---|---|
| TypeScript typecheck | VERIFIED | `.artifacts/manual-certification/static/TYPECHECK-20261123T124246Z.stdout.log`; `summary-20261123T124246Z.txt` |
| Production build | VERIFIED | `.artifacts/manual-certification/static/BUILD-20261123T124246Z.stdout.log`; `summary-20261123T124246Z.txt` |
| Native ESM | VERIFIED — 72 modules, 99 relative imports | `.artifacts/manual-certification/static/ESM-20261123T124246Z.stdout.log`; `summary-20261123T124246Z.txt` |
| MCP PostgreSQL RLS | VERIFIED — 11 passed, 0 failed, 0 skipped | `.artifacts/manual-certification/mcp-rls/mcp-rls-summary.json`; `mcp-rls-vitest.json`; stdout/stderr logs |
| Canonical zero-skip release | VERIFIED — 305 passed, 0 failed, 0 skipped | `.artifacts/release-test/latest-summary.json`; `latest-vitest.json`; `latest-stdout.log`; `latest-stderr.log` |
| `verify:release` | VERIFIED | `.artifacts/manual-certification/verify-release/stdout.log`; `stderr.log` |
| External identity PostgreSQL gate | PASS — 29 assertions | Retained manual-certification gate evidence and supplied final gate record |
| Auth0 HTTP/PostgreSQL gate | PASS — 19 assertions, 0 skipped | Retained manual-certification gate evidence and supplied final gate record |
| Academy learner lifecycle gate | PASS — 16 assertions, 0 skipped | Retained manual-certification gate evidence and supplied final gate record |
| Audit ledger gate | PASS — 23 assertions, 0 skipped | Retained manual-certification gate evidence and supplied final gate record |

The release JSON reports `status=VERIFIED`, `exitCode=0`, `passed=305`, `failed=0`, `skipped=0`, and no failed tests. The Vitest JSON independently records 305 passed, 0 failed, 0 pending, and `success=true`.

### Historical failure chronology — retained, not current

A genuine earlier canonical run produced 304 passed / 1 failed / 0 skipped. The failed restricted-runtime-identity assertion observed `session_user=u0_a427` and `current_user=u0_a427` instead of `nabuuma_runtime`. The diagnosed cause was the original release environment collapsing administrative fixture and application runtime identities into one database URL. The environment wiring was subsequently corrected to use separate administrative and runtime connections; restricted runtime login provisioning was automated; the MCP RLS suite then passed 11/0/0; the canonical zero-skip release passed 305/0/0; and `verify:release` passed.

The 304/1/0 result remains valid historical failure evidence. It is not the current release result and must not be described as spurious or deleted from chronology.

### Database identity contract — intentional split

- Administrative/fixture connection: `PGHOST=127.0.0.1`, `PGPORT=55445`, `PGDATABASE=nabuuma_rls_test`, `PGUSER=u0_a427`. Used for fixture setup and privileged disposable-database operations.
- Application runtime connection: `NABUUMA_TEST_DATABASE_URL`, independently credentialed as `nabuuma_runtime` on `127.0.0.1:55445/nabuuma_rls_test`.

The different usernames are intentional and are not an environment inconsistency. The runtime session was verified as `session_user=nabuuma_runtime`, `current_user=nabuuma_runtime`; the role has LOGIN and lacks INHERIT, SUPERUSER, CREATEDB, CREATEROLE, REPLICATION, and BYPASSRLS. Membership in `nabuuma_app` has `admin_option=false`, `inherit_option=false`, `set_option=true`.

## 3. Bootstrap and role recovery

### Clean migration replay

`scripts/bootstrap-postgres-roles.sql` is the pre-migration bootstrap contract: it creates only the cluster-global prerequisite `nabuuma_runtime` as NOLOGIN, NOINHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS. Migration-owned roles remain owned by canonical migrations 00001–00022 and are not duplicated in the pre-migration bootstrap. Fresh replay of all 22 migrations passed. Post-migration provisioning converts the runtime role to the restricted LOGIN identity and grants `nabuuma_app` membership.

Evidence: `.artifacts/manual-certification/bootstrap-replay/bootstrap.log`, `initdb.log`, `migrations.log`, `postconditions.log`, `runtime-provision.log`, and `postconditions-after-runtime.log`.

### Logical restore role bootstrap

Logical archives do not carry cluster-global role definitions. Restore therefore uses `scripts/bootstrap-postgres-restore-roles.sql`, which provisions `nabuuma_app`, `nabuuma_auth_owner`, `nabuuma_certificate_revoke_owner`, `nabuuma_certificate_verifier`, and `nabuuma_runtime`. The role bootstrap and idempotency checks passed. No passwords or password hashes are restored by this bootstrap.

Evidence: `.artifacts/manual-certification/restore-role-proof/` and `.artifacts/manual-certification/restore/role-bootstrap.log`.

## 4. Backup, restore, and parity certification

**BACKUP_RESTORE = VERIFIED**

- Source: `127.0.0.1:55445/nabuuma_rls_test`.
- Archive: `$HOME/.cache/nabuuma-canonical-recovery-certification/backups/nabuuma-postgres-20261123T162522Z.dump`.
- Format: PostgreSQL custom format; `pg_restore --list` passed.
- SHA-256 checksum verified; archive mode 0600; checksum and metadata mode 0600; backup directory mode 0700.
- Source manifest: `.artifacts/manual-certification/source-manifest-v2-final.json` (mode 0600).
- Restore target: `nabuuma_canonical_restore_test` on port 55446.
- `pg_restore` passed. No migrations were applied after restore.
- Restored manifest: `.artifacts/manual-certification/restored-manifest-v2-final.json`.

| Recovery dimension | Result |
|---|---|
| Relations and data | VERIFIED |
| Columns | VERIFIED |
| Constraints | VERIFIED — 696 source / 696 restore |
| Semantic constraint parity | VERIFIED — 696 canonical identities each; zero source-only and zero restore-only |
| Indexes | VERIFIED |
| Policies | VERIFIED |
| Triggers | VERIFIED |
| Functions | VERIFIED |
| Sequences | VERIFIED |
| Relation ACL | VERIFIED |
| Routine ACL | VERIFIED |
| Schema ACL | VERIFIED |
| Role attributes and memberships | VERIFIED |

### Constraint reconstruction notes

Partition-derived audit foreign keys were reconstructed semantically: 50 source child FKs and 50 restore child FKs, all with `conparentid`; zero semantic source-only or restore-only definitions; parent definitions identical. Automatically reconstructed child constraint names differ and were intentionally not renamed.

Twenty-six audit outcome CHECK constraints had two PostgreSQL textual representations of the same SUCCESS/FAILURE text-array expression. No other unexplained definition differences remained. Raw source and restore manifests remain unchanged as forensic evidence.

## 5. Post-restore security certification

**POST_RESTORE_SECURITY_CANARIES = VERIFIED**

- Required trigger identities: 3/3; physical instances: assessment immutability 1, audit immutability 26, certificate-revocation immutability 1.
- Security state: 32 policies; 3 distinct required trigger names.
- Runtime role: superuser=false, bypassrls=false, inherit=false.
- Runtime `EXECUTE` on `resolve_external_identity` and `verify_academy_certificate`: allowed.
- Runtime direct `SELECT` on `external_identities`, `organisation_memberships`, and `academy_certificates`: denied.
- Runtime `SET ROLE nabuuma_auth_owner`: denied.
- External identity resolver and certificate verifier: verified.
- Audit UPDATE/DELETE: denied.
- Certificate-revocation UPDATE/DELETE: denied.
- Assessment UPDATE/DELETE: denied; exact immutability error: `Assessments are immutable; create a new assessment version`.
- Synthetic assessment dependency graph existed only inside a transaction. Pre/post canary counts remained `18|34|0|0|0|0|0`; outer transaction rollback verified; no synthetic fixture persisted.

Evidence: `.artifacts/manual-certification/restore-security/` and the source/restored manifests. No canary was rerun during this reconciliation.

## 6. Final hygiene

**FINAL_HYGIENE = VERIFIED**

- Raw secret-shaped scanner matches: 24; all classified as documentation/example placeholders, explicit test fixture credentials, CI fixture credentials, variable-based connection-string construction, or REDACTED example configuration.
- Unclassified secret-shaped matches: 0; `.artifacts/manual-certification/final-secret-scan-unclassified.txt` is empty.
- Private keys: 0.
- Tracked sensitive artefacts: 0.
- `git diff --check`: exit code 0 after creation of this reconciliation report; no whitespace errors were reported.

Evidence: `.artifacts/manual-certification/final-secret-scan.txt`, `final-secret-scan-raw.txt`, and `final-secret-scan-unclassified.txt`.

## 7. Process state and protected boundaries

The following states are carried forward from the final operator-certified handoff; this documentation reconciliation did not inspect or alter PostgreSQL process state:

| Port | Certified state | Boundary |
|---|---|---|
| 55433 | RUNNING | Protected existing recovery-copy database. No connection, mutation, stop, restart, role change, or migration is permitted under this closure. |
| 55445 | RUNNING | Disposable canonical evidence/source cluster. Not stopped or removed. |
| 55446 | STOPPED | Disposable restore cluster. Not started. |

## 8. Superseded interim reports and preserved history

The following reports remain unchanged and must be read as execution-time records, not current certification summaries:

- `NABUUMA-BOOTSTRAP-CLOSURE-REPORT-2026-11-23.md`: its 47/49 comparison, incomplete ACL/recovery statements, earlier 2-failure/44-skip run, and `BOOTSTRAP_CLOSURE_READY=NO` describe the earlier closure attempt. Those findings are superseded only for the later canonical recovery/release evidence documented here. Its container, digest-pinning, independent-backup, and hosted-provider limitations are not silently converted to PASS.
- `NABUUMA-ENGINEERING-EVIDENCE-RECOVERY-2026-11-23.md`: its 302/0/0 historical baseline, 259/2/44 non-comparable run, and then-current `NOT_VERIFIED` statements describe the earlier recovery execution. They are superseded for current release and local recovery status by the later retained evidence referenced in this report.
- `NABUUMA-BOOTSTRAP-RESILIENCE-REPORT-2026-11-23.md`: its earlier successful drill remains historical evidence; the later final archive/restore and parity proof is recorded above.
- `ENGINEERING-EVIDENCE-CHECKPOINT.md`: its 302/0/0 entry remains historical and is superseded as the current release count by the retained 305/0/0 canonical release result.

No raw report, manifest, log, backup, checksum, metadata file, or pre-evidence-repair snapshot was deleted or rewritten.

## 9. Remaining open / blocked work — outside this local closure verdict

These items remain external or deployment-hardening work and are not represented as completed by this report:

- Independent encrypted off-device backup and retrieval test: BLOCKED_EXTERNAL_AUTHORITY; no authorized independent storage target/key custody was used.
- Hosted provider capability and deployment smoke test: BLOCKED_EXTERNAL_AUTHORITY; no hosted provider account/project was provisioned.
- OCI image build/runtime and Compose/Caddy runtime verification: BLOCKED_ENVIRONMENT where Docker/Podman tooling is unavailable.
- Authoritative base-image digest resolution/pinning: NOT_VERIFIED.
- Monitoring and scheduled backup operations: OPEN; not part of this local bootstrap/recovery certification.
- Explicit lifecycle decision for the running disposable source/evidence cluster on 55445: OPEN; leave running until separately authorized.
- Explicit decision on `scripts/run-zero-skip-tests.mjs.pre-evidence-repair`: OPEN; preserve the untracked snapshot.
- Existing modified and untracked implementation files remain user-owned working-tree changes. No commit, push, tag, deployment, reset, stash, or cleanup is authorized by this report.

## 10. Final certification verdict

```text
STATIC_CERTIFICATION=VERIFIED
ZERO_SKIP_RELEASE=VERIFIED (305 passed, 0 failed, 0 skipped)
VERIFY_RELEASE=VERIFIED
BACKUP_RESTORE=VERIFIED
POST_RESTORE_SECURITY=VERIFIED
FINAL_HYGIENE=VERIFIED
PROTECTED_PORT_55433_MUTATION=NONE
BOOTSTRAP_CLOSURE_READY=YES
```

This verdict applies to the local bootstrap, canonical zero-skip release, logical backup/restore, parity, and post-restore security scope evidenced above. It does not assert production deployment, hosted-provider readiness, independent off-device backup, or completion of the separately listed lifecycle decisions.

## 11. Reconciliation execution record

- New file: this report only.
- Existing reports and implementation files: unchanged by this reconciliation.
- PostgreSQL: no connections or mutations.
- Git lifecycle: no commit, push, tag, deployment, reset, or stash.
- Final `git diff --check`: exit code 0 after report creation. Final `git status --short --branch` showed the pre-existing modified and untracked implementation paths still present, plus the new report under the already-untracked `docs/` directory; no pre-existing path was removed or reset.
