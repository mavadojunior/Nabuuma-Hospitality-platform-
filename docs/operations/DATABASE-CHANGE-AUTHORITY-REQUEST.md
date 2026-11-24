# Database Change Authority Request

**CONFIDENTIAL — INTERNAL ENGINEERING / SECURITY / RELEASE**

This request is for explicit authority to execute the rehearsed forward migrations against the approved target. It contains no secrets and is not itself approval.

## Requested scope

Target: 127.0.0.1:55433 / nabuuma_rls_test, PostgreSQL 18.2.

Forward migrations, in order:

1. 00020_allow_runtime_certificate_verification.sql
2. 00021_external_identity_resolution_authority.sql
3. 00022_reconcile_audit_ledger_architecture.sql

Run read-only preflight first, then only required migrations using the approved migration identity and stop-on-error, then execute deployment/sql/approved-db-postconditions.sql. No PostgreSQL engine upgrade, Auth0 mutation, EAS build, production release or unrelated schema work is included.

## Authority required from the accountable operator

- Approved migration-capable database identity and scope (identity name only; do not send credentials here).
- Change/approval record identifier.
- Maintenance window and traffic/state plan.
- Verified fresh backup and recovery point; restore verification and role/ownership bootstrap acknowledgement.
- Rollback/restoration owner and approved recovery plan.
- Explicit approval to execute after read-only preflight passes.

## Evidence available

- Target-specific clone rehearsal passed for migrations 00020–00022.
- Nine original audit rows preserved with matching deterministic digest and timestamps in rehearsal.
- Approved-target read-only preflight passes against the locked baseline.
- CI provisions constrained runtime before migration, applies strict ordinal migrations, and invokes the read-only postcondition manifest.
- Runtime clone HTTP smoke and live Auth0/EAS authority remain outstanding.

## Stop criteria

Any identity/version/baseline drift, backup or restore uncertainty, migration failure, audit preservation mismatch, privilege mismatch, invalid/orphan row, postcondition failure or unauthorised identity stops the change. No manual repair or privilege elevation is permitted under this request.

Status: NOT AUTHORISED. The approved database has not been modified.
