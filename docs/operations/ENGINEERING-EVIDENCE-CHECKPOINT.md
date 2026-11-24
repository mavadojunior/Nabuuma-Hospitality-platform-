# Nabuuma engineering and operational readiness checkpoint

Date: 2026-11-23

## Verified engineering evidence (locked; no heavy backend suite rerun)

- Source migration lineage: 00001 → 00022.
- Isolated clean replay and 00022 audit-ledger reconciliation: PASS.
- External identity PostgreSQL integration: 29 assertions PASS.
- Auth0 HTTP/PostgreSQL integration: 19 assertions PASS.
- Academy learner lifecycle: 16 assertions PASS, 0 skipped.
- Certificate UNKNOWN / VALID / REVOKED paths: isolated Fastify/PostgreSQL PASS.
- Authorised assessor revocation: PASS; unauthorised learner and cross-tenant denial: PASS.
- Zero-skip regression: 302 passed, 0 failed, 0 skipped.
- `npm run verify:release`: PASS.
- Backend source and migration readiness: PASS.

## Final operational checks executed in this continuation

- Secret scan across backend/mobile text source, tracked modifications and untracked files, excluding `.git`, dependency/build output and binaries: PASS.
- Strong literal credential classes checked: private-key PEM, AWS key, GitHub/GitLab/NPM token, Stripe/Slack/Google key, JWT literal and bearer literal. Strong literal findings: 0.
- Sensitive assignment candidates classified as placeholder/environment references, synthetic tests/CI, or code references. No potential real secret remained after classification.
- Ignored `.env.production`: local test-database URL only, no embedded password; classified synthetic test configuration. Private runtime configuration was not accessed.
- Mobile/backend contract comparison: 11 assertions PASS. Exact GET route, auth, response wrapper, DTO subset, no pagination assumption, token use, fail-closed behavior and HTTPS/base URL validation.
- Mobile Academy API client: 35 assertions PASS, 0 skipped.
- Mobile TypeScript: PASS.
- Expo install compatibility: dependencies up to date.
- Expo Doctor: 20/20 checks PASS.
- Mobile `git diff --check`: PASS.
- Auth0 Post-Login Action consistency test: 1/1 PASS.
- Auth0 Action source matches namespace `https://api.nabuuma.com/roles`; assigned `event.authorization.roles` only; no organisation claim authority or secret embedding.
- EAS `whoami`: `Not logged in`. Local EAS project link file and owner/projectId config are absent. No EAS mutation/build attempted.

## Prepared operational artefacts

- `docs/operations/OPERATIONAL-CUTOVER-READINESS.md`: approved DB migration sequence, catalogue-first equivalence, Auth0 cutover/canary/rollback, identity provisioning and EAS development build handoff.
- `deployment/sql/approved-db-postconditions.sql`: read-only assertions for 00019–00022 authority, 00020 verifier runtime grant, 00021 external identity resolver, 00022 audit ledger partition/PK/RLS/policies/indexes/FKs/continuity.
- Migration and Auth0/EAS runbooks are preparation only; neither live cutover nor approved-target SQL was executed.

## Authority and readiness

| Readiness | State |
|---|---|
| SOURCE_READY | VERIFIED |
| ISOLATED_INTEGRATION_READY | VERIFIED |
| ZERO_SKIP_RELEASE_TEST_READY | VERIFIED |
| VERIFY_RELEASE_READY | VERIFIED |
| AUDIT_LEDGER_PARITY_READY | VERIFIED_ISOLATED |
| AUTH0_CUTOVER_READY | VERIFIED_SOURCE |
| FULL_LIFECYCLE_E2E | VERIFIED |
| ISOLATED_CERTIFICATE_ACCEPTANCE | VERIFIED |
| ISOLATED_LEARNER_E2E_READY | VERIFIED |
| MOBILE_API_CLIENT_READY | VERIFIED |
| FINAL_SECRET_SCAN | PASS |
| OPERATIONAL_RUNBOOK_READY | VERIFIED |
| REAL_DB_MIGRATION_READY | BLOCKED_EXTERNAL_AUTHORITY |
| LIVE_AUTH_READY | BLOCKED_EXTERNAL_AUTHORITY |
| MOBILE_BUILD_READY | BLOCKED_EXTERNAL_AUTHORITY |
| PRODUCTION_RELEASE | BLOCKED_EXPLICIT_APPROVAL |

## Authority checks

- Approved DB migration authority: no explicit secure migration credential/authority supplied; no attempt to source private runtime config. Target port 55433 remains untouched.
- Auth0 administrative authority: no Auth0 admin connector or authorised credential available in current tool/account context.
- EAS authority: unauthenticated. Project linkage absent. Development APK not built.

## Git and execution boundaries

- Backend branch: `feat/academy-enrolment-certificate-hardening`.
- Mobile branch: `master`.
- Both `git diff --check` gates PASS.
- Existing tracked/untracked changes preserved; no staging, commit, push or tag.
- No production deployment, approved DB mutation, runtime provider switch, Auth0 deployment, Expo credential guessing or production release.
- Disposable PostgreSQL port 55445 was stopped after isolated release verification. Port 55433 remains accepting connections and was not modified by this continuation.

## Exact next operator sequence after authority

1. Approve migration change/window and securely supply migration authority.
2. Backup and restore-validate target; run read-only catalogue baseline; decide migration equivalence individually for 00020–00022.
3. Apply only required forward migrations transactionally; execute the postcondition SQL; record audit baseline/count continuity.
4. Provision one controlled Auth0 external identity mapping under approved authority; verify resolver principal.
5. Approve Auth0 Action/API/callback configuration; perform controlled provider cutover and canary matrix; rollback on critical failure.
6. Authenticate Expo/EAS owner authority; confirm `nabuuma/nabuuma-mobile` project link and public environment; build development APK only.
7. Install and execute mobile login/course/cross-tenant canaries; archive evidence.
8. Production release requires a separate explicit approval.


SQL postcondition manifest: structural checks passed. No SQL parser is installed in this environment; the manifest was not executed against any database and requires authorised operator validation before use.
