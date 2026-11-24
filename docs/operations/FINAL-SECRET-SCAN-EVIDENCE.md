# Final secret-scan evidence — 2026-11-23

## Result

`FINAL_SECRET_SCAN=PASS`

- Strong literal credential matches: **0**.
- Potential real secrets after classification: **0**.
- 53 sensitive-assignment/URL candidates were classified without printing values.
- Scan scope: both project trees, tracked source/config, modified/untracked files, docs, tests, scripts, CI, deployment files; `.git`, dependency/build output, temporary PGDATA and binaries excluded.
- Private `~/.config/nabuuma/runtime.env` was not accessed.

## Strong literal classes checked

PEM private-key blocks, AWS access keys, GitHub/GitLab/NPM tokens, Stripe/Slack/Google keys, JWT literals, and literal bearer credentials. All zero matches.

## Candidate classification record

| Repository | Path / line | Category | Tracking | Classification |
|---|---|---|---|---|
| backend | `verify-release.sh`: 48,49,149,178,330,409,424,431,476,497,503,511,529,558,597,604,607,622,636,653,673,785,885 | password/database env references | tracked | PLACEHOLDER_OR_ENV_REFERENCE |
| backend | `verify-release.sh`: 670 | credential-bearing URL template | tracked | SYNTHETIC_DISPOSABLE_DYNAMIC_CREDENTIAL (generated temporary test role/password; loopback test DB) |
| backend | `src/infrastructure/database/connection.ts`: 26 | DB URL format example | tracked | DOCUMENTATION_FORMAT_EXAMPLE |
| backend | `tests/RlsRelationshipSecurity.spec.ts`: 33 | test password | tracked | SYNTHETIC_TEST |
| backend | `tests/AcademyRlsSecurity.spec.ts`: 33 | test password | tracked | SYNTHETIC_TEST |
| backend | `tests/AcademyCourseCompletion.spec.ts`: 66 | test password | tracked | SYNTHETIC_TEST |
| backend | `tests/CertificateVerificationSecurity.spec.ts`: 12 | test password | tracked | SYNTHETIC_TEST |
| backend | `tests/CertificateRevocationSecurity.spec.ts`: 23 | test password | tracked | SYNTHETIC_TEST |
| backend | `tests/AcademyPolicyCorrelationSecurity.spec.ts`: 33 | test password | tracked | SYNTHETIC_TEST |
| backend | `tests/RuntimeAuthentication.integration.spec.ts`: 217,235 | test access-token fixture | tracked | SYNTHETIC_TEST |
| backend | `tests/McpPostgresRlsE2E.integration.spec.ts`: 914 | test access-token fixture | tracked | SYNTHETIC_TEST |
| backend | `tests/ProductionBuildConfig.spec.ts`: 69 | disposable DB URL | tracked | SYNTHETIC_TEST |
| backend | `.github/workflows/release-gate.yml`: 62,77,103,254 | CI DB/password variables | tracked | SYNTHETIC_TEST_OR_CI |
| backend | `.github/workflows/release-gate.yml`: 79,190 | disposable database URLs | tracked | SYNTHETIC_TEST_CREDENTIAL |
| backend | `.github/workflows/release-gate.yml`: 111 | variable/placeholder | tracked | PLACEHOLDER_OR_ENV_REFERENCE |
| backend | `.github/workflows/publish-release.yml`: 103 | password variable | tracked | PLACEHOLDER_OR_ENV_REFERENCE |
| backend | `.github/workflows/verify-release.yml`: 108 | password variable | tracked | PLACEHOLDER_OR_ENV_REFERENCE |
| backend | `scripts/verify_runtime_e2e.sh`: 14,35,244,246,252,253,386 | E2E token references | tracked | ENVIRONMENT_TOKEN_REFERENCE / PLACEHOLDER_OR_SYNTHETIC_TEST |
| backend | `scripts/test-auth0-http-postgres.mjs`: 18 | synthetic test admin connection | untracked | SYNTHETIC_TEST_FIXTURE |
| mobile | `src/api/academy-client.ts`: 24 | access-token provider code | untracked | RUNTIME_TOKEN_CODE_REFERENCE |
| backend | `.env.production`: 1 | DATABASE_URL | untracked/ignored | SYNTHETIC_TEST_CONFIGURATION (loopback test DB; no embedded password) |

No candidate contains a confirmed real credential. The local ignored `.env.production` URL was checked by derived metadata only; it points to loopback/test database and has no password. Fixed CI test credentials are scoped to ephemeral test services.

## Classification rule

Values were never emitted. Literal token/key patterns were checked separately. Sensitive assignment matches were classified from path/context/value shape as placeholders/environment references, synthetic test/CI values, documentation examples, or code references. Any unresolved literal would be `POTENTIAL_REAL_SECRET` and fail the scan; none remained.
