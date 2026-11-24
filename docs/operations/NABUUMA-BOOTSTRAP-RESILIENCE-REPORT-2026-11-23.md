# NABUUMA BOOTSTRAP RESILIENCE REPORT

**Date:** 2026-11-23
**Execution:** Autonomous engineering on disposable PostgreSQL 18.2 cluster
**Authority boundary:** No approved database mutation, cloud provisioning, paid service, commit, push, or cutover.

## 1. Backup utility
- scripts/backup-postgres.sh created/hardened.
- PostgreSQL custom-format dump.
- pg_restore archive-list verification.
- SHA-256 and metadata.
- Restrictive permissions: backup 0600, metadata/checksum 0600, backup directory 0700.
- Archive retains object ownership and ACLs; global roles must be bootstrapped separately.
- Backup is local only; no encrypted off-device copy was performed.

## 2. Restore proof
BACKUP_RESTORE_VERIFIED=YES

The complete migrations 00001–00022 were applied to a new disposable PostgreSQL 18.2 cluster, with only the required runtime role pre-created. Synthetic canonical data was seeded. The source database was dropped after backup. The custom archive was restored into a separately created disposable database.

Restore verification passed:
- Archive checksum and pg_restore listing.
- 49 Nabuuma table/partition catalog entries.
- Source and restored manifest equality for table row counts and deterministic data digests.
- Table owners, RLS/FORCE-RLS flags, partition bounds.
- Policies.
- Non-internal triggers and definitions.
- Function definitions, owners, SECURITY DEFINER, pinned search_path and function ACLs.
- Nabuuma schema ACL.
- 25 audit child partitions.
- External identity resolver returned expected synthetic user/organisation/role.
- Certificate verifier returned expected synthetic certificate and course.
- Runtime direct SELECT from external identities denied.
- Runtime EXECUTE on resolver/verifier succeeded.
- Runtime role attributes checked as NOLOGIN, NOSUPERUSER, NOCREATEROLE, NOCREATEDB and NOBYPASSRLS.

The source and restore manifest row-count totals were each 14 catalog table rows; the audit partitioned parent and its child both represent the same one logical audit event, so the logical synthetic seed was 13 inserts.

## 3. Backup/restore totals
- Archive: 330,098 bytes.
- SHA-256: 9b5f266e60d5ab9a9ed70399606a18f68f2ae4edf1244e0d3a561384748a9066
- PostgreSQL tools: 18.2.
- Synthetic seed inserts: 13.
- Source DB: destroyed.
- Restore DB: destroyed after test.
- Disposable cluster: stopped and removed.
- Archive and manifest evidence retained in the private cache directory.

## 4. Provider probe
scripts/probe-postgres-provider.mjs created.

PASS against disposable PostgreSQL 18.2 restore:
- Version 16+.
- Transactions/savepoints.
- Custom GUC.
- RLS and FORCE RLS.
- Partitioned table and child partition.
- Policy creation/catalog.
- SECURITY DEFINER and restricted search_path.
- PUBLIC EXECUTE revoked.
- Schema USAGE/CREATE.
- pgcrypto available and installed.
- Required Nabuuma roles present with safe attributes.
- SET ROLE nabuuma_app.

Probe requires DATABASE_URL, database name identifying disposable/test/probe/sandbox/drill, and NABUUMA_DISPOSABLE_TARGET=YES. Probe objects are transaction-rolled back.

## 5. Portability contract
Created docs/architecture/PORTABLE-DEPLOYMENT-CONTRACT.md: Node/Fastify, PostgreSQL minimum, extensions/privileges, Auth0/OIDC, TLS, environment/secrets, health probes, logging, resource planning, restart semantics and provider-neutral requirements.

## 6. Container package
Existing Dockerfile inspected; it already has multi-stage dependency/build/runtime stages, production-only dependencies, distroless Node runtime, non-root user, NODE_ENV=production, liveness healthcheck and SIGTERM.

Updated .dockerignore to exclude runtime secrets, backup archives, private configs and non-runtime docs/deployment files. OCI Compose/Caddy package created with private API network, read-only container, dropped capabilities, no-new-privileges, restart policy and TLS reverse proxy.

Docker/Podman unavailable on device; image build was NOT executed. Base-image digest pinning remains a release-hardening gap.

## 7. Provider matrix
Created docs/operations/ZERO-COST-PROVIDER-MATRIX.md. Publicly verified and account-test-needed facts are separated for Azure startup path, AWS Activate, Google for Startups Cloud, OCI Free Tier, Neon, Supabase and Cloudflare Workers/Pages/R2.

No provider account, cloud project, billing conversion or resource was created.

## 8. Microsoft packet
Created docs/funding/MICROSOFT-FOR-STARTUPS-APPLICATION-PACKET.md. Engineering evidence, use-of-resources, 90-day objectives and missing company facts documented. Not submitted; eligibility unknown.

## 9. AWS packet
Created docs/funding/AWS-ACTIVATE-APPLICATION-PACKET.md. Known evidence, published criteria, unknown eligibility and potential technical credit use documented. Not submitted; eligibility unknown.

## 10. Google eligibility packet
Created docs/funding/GOOGLE-FOR-STARTUPS-ELIGIBILITY.md. Criteria mapping and missing facts documented. Not submitted; eligibility unknown.

External account, billing and application actions must be handled by an eligible authorized adult/representative; no legal, funding, website, company-status or credit-award facts were fabricated.

## 11. OCI blueprint
Created deployment/oci/README.md, compose.yaml, Caddyfile and environment examples. No OCI provisioning.

## 12. Backup storage strategy
Created docs/operations/BACKUP-AND-RECOVERY-STRATEGY.md:
- Local logical backup.
- Encrypted off-device copy using standard audited encryption; key separation.
- Checksum validation.
- Proposed synthetic-data retention only.
- Role bootstrap and restore drill.
- No custom cryptography.
- No off-device encryption/copy was performed.

## 13. Static gates
PASS:
- Shell syntax.
- Node syntax checks.
- Typecheck.
- Build.
- ESM verification: 72 modules / 99 relative imports.
- Test suite: 259 passed, 46 skipped across 48 files.
- git diff --check.

Skipped tests are database/environment-dependent integration/security tests; they were not falsely reported as passing.

## 14. Secret scan
PASS on newly added funding, architecture, provider, OCI and backup/probe files. No credential/private-key patterns detected. Examples use redacted values.

## 15. Git integrity
- No commit.
- No push.
- Existing uncommitted engineering changes preserved.
- No migration executed against approved database.
- No cloud resource or paid service provisioned.

## 16. BOOTSTRAP_RESILIENCE_READY
PARTIAL — backup restore and provider capability probe verified; portable deployment and assistance artefacts established. Container build and external infrastructure remain unverified.

## 17. Remaining zero-cost gaps
- Encrypted off-device backup copy and independent storage access.
- Docker build/image inspection.
- Full provider account capability/role-ownership test.
- Database table ACL full comparison beyond archive restoration and tested runtime identity privilege canaries.
- Deployment smoke test on an actual provider/VM.
- Monitoring and backup scheduling.

## 18. Remaining external-authority gaps
- Authorized provider account/project provisioning.
- Legal/company facts and eligibility for startup programmes.
- DNS and TLS domain authority.
- Cloud service limits and regional capacity.
- Any billing/account terms.
- Production data governance and recovery policy approval.

## 19. Recommended next zero-cost action
Keep the verified local archive and manifest evidence. Before any hosted database, provision a disposable provider test database through an authorized account holder, run the capability probe, then rehearse encrypted off-device backup/restore without real user data. Do not connect production data until recovery and access controls pass.
