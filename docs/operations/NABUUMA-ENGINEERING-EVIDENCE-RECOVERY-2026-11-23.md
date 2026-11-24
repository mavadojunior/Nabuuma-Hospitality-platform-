# NABUUMA RESILIENCE EVIDENCE RECOVERY FINAL
CONFIDENTIAL — INTERNAL ENGINEERING / SECURITY / RELEASE

## 1. Evidence correction
- `PREVIOUS_RELEASE_EVIDENCE = VERIFIED_HISTORICAL`: prior zero-skip release evidence was 302 passed, 0 failed, 0 skipped; prior full learner lifecycle was 16/0/0; Auth0 HTTP/PostgreSQL, external identity PostgreSQL, audit reconciliation, target-derived migration rehearsal and backup/restore were previously reported verified. Historical artefacts were not overwritten.
- `LATEST_BOOTSTRAP_RUN = INVALID_FOR_RELEASE_COMPARISON`: 259 passed, 2 failed, 44 skipped did not use the canonical normalized integration environment. It does not supersede the historical release result and is not proof of security regression.
- The latest observed certificate failures were connection configuration errors (`no PostgreSQL user name specified in startup packet`), not observed assertion failures.

## 2. Persistent failure diagnostics
- Updated `scripts/run-zero-skip-tests.mjs` to retain JSON, stdout, stderr and a summary under `.artifacts/release-test/` (override with `NABUUMA_RELEASE_ARTIFACT_DIR`). This path is git-ignored. Failed results no longer trigger diagnostic deletion.
- Synthetic failure-retention fixture: 1 passed, 1 failed, 2 skipped in the fixture JSON; runner returned nonzero and retained summary. `FAILURE_REPORT_RETENTION = VERIFIED`.
- The runner's real Vitest JSON output parsing was not revalidated against a full release run in this execution.

## 3. Canonical test DB environment
- Added `scripts/lib-release-test-db-env.mjs`, deriving `NABUUMA_TEST_DATABASE_URL` and `PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD` from one PostgreSQL URL.
- Adapter refuses malformed URLs, non-PostgreSQL schemes, non-local hosts, port 55433, `nabuuma_rls_test`, and names lacking test/disposable/drill/recovery markers. It never logs credentials.
- Adapter tests: 3 passed, 0 failed, 0 skipped. `RELEASE_DB_ENV_COHERENT = VERIFIED` for unit fixture; no live disposable DB was provisioned in this recovery run.

## 4. Certificate security tests
- Canonical environment adapter unit tests pass.
- Certificate security integration suite was not rerun against a freshly migrated disposable database. Both certificate assertions remain `NOT_VERIFIED` in this recovery execution.

## 5. Zero-skip release gate
- Full canonical release command not executed: no disposable database was provisioned for this recovery execution, and Desktop Commander monthly usage reached 95% during work.
- Historical 302/0/0 remains verified historical. Current release evidence `NOT_VERIFIED`.

## 6. Evidence reconciliation
- Historical run: 302 passed / 0 failed / 0 skipped; environment fingerprint unavailable in current report; comparability class `VERIFIED_HISTORICAL`.
- Bootstrap run: 259 passed / 2 failed / 44 skipped; mixed/incomplete DB environment; class `INVALID_FOR_RELEASE_COMPARISON`.
- Current canonical run: not executed; class `NOT_EXECUTED`.

## 7–16. Backup, restore and parity
- Fresh recovery source/restore rehearsal, deterministic data parity, structural parity, table/sequence/routine/schema ACL parity and role recovery were not executed in this recovery run. Status: `NOT_VERIFIED`.
- The previous bootstrap report's `FAIL`, `MISMATCH` and `FAIL` placeholders for non-executed comparisons are not valid failure evidence. They are corrected here to `NOT_VERIFIED`.

## 17. Security canaries
- Fresh post-restore canaries not executed. `NOT_VERIFIED`.

## 18–20. Approved target
- 47 vs 49 relation count explained by canonical migration objects `nabuuma.audit_events_default` and `nabuuma.external_identities`, absent on approved DB 55433 and present after canonical migrations 00001–00022.
- Full approved-target catalogue comparison: `BLOCKED_INSUFFICIENT_READ_AUTHORITY`. Approved DB was not mutated.
- Canonical backup/restore parity remains independently verifiable and is not equated with approved-target equivalence.

## 21–24. Infrastructure
- Container static configuration previously inspected; this execution did not rerun static inspection or build. Container build/runtime/Compose runtime: `BLOCKED_ENVIRONMENT` (Docker/Podman/Buildah unavailable in prior verified environment).
- Image digest pinning: `NOT_VERIFIED` (digest not resolved in this execution).
- Independent backup: `BLOCKED_EXTERNAL_AUTHORITY`.
- Hosted provider probe: `BLOCKED_EXTERNAL_AUTHORITY`. Prior local provider capability probe was reported verified historically.

## 25. Reporting semantics
Use `VERIFIED`, `FAILED`, `NOT_VERIFIED`, `BLOCKED`, `NOT_EXECUTED`. Comparisons report `FAILED` only after actual inequality. Do not emit placeholder `MISMATCH` or non-execution `FAIL`.

## 26. Source validation
- Adapter tests: 3 passed / 0 failed / 0 skipped.
- Typecheck/build/ESM validation were started, but completion output was not captured before execution capacity limitation. `NOT_VERIFIED`.
- `git diff --check` result not captured after the final changes. `NOT_VERIFIED`.

## 27. Git integrity
- No commit, push, tag, deployment or approved DB mutation.
- Pre-existing changes preserved. Added runner, adapter, adapter tests, gitignore artifact exclusion and this report. `.artifacts/` is ignored.

## 28. Verdict
`BOOTSTRAP_CLOSURE_READY = NO`.
Remaining engineering execution requires a canonical disposable PostgreSQL environment, full zero-skip release run, and fresh backup/restore parity drill. Independent storage and hosted provider tests require external authority. Container runtime gates require compatible tooling.
