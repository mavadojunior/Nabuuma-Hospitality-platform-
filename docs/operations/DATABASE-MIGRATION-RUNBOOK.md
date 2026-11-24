# NABUUMA Database Migration Runbook

**CONFIDENTIAL — INTERNAL ENGINEERING / SECURITY / RELEASE**

Status: rehearsal evidence established; approved target remains unmigrated and execution is not authorised.

## Scope

Forward migrations only:

1. `00020_allow_runtime_certificate_verification.sql`
2. `00021_external_identity_resolution_authority.sql`
3. `00022_reconcile_audit_ledger_architecture.sql`

Target reference: `127.0.0.1:55433/nabuuma_rls_test`, PostgreSQL 18.2. Do not upgrade PostgreSQL as part of this change.

## Authority and preconditions

Do not start until the change record explicitly supplies/records:

- approved migration-capable identity, scoped to the required database/schema changes;
- approval/change-record ID and maintenance window;
- verified operator-owned backup and recovery point;
- restoration procedure tested against a disposable instance and acknowledgement that role bootstrap/ownership prerequisites are understood;
- application traffic/state requirements and restart authority;
- target identity and read-only preflight PASS.

The current local database operator identity is not evidence of migration authority.

## Read-only preflight

Run with an operator-approved connection and stop on any SQL error:

```sh
psql -X -w -v ON_ERROR_STOP=1 -f deployment/sql/approved-db-preflight.sql
```

The SQL begins a READ ONLY transaction, asserts database identity, PostgreSQL major 18, baseline audit count/digest, partition architecture, migration-object absence, runtime authority baseline, invalid/orphan rows, prints safe structured evidence, and rolls back. It emits no audit row payload.

Expected rehearsal baseline: 9 rows; digest `267ca16fc4a03b6caddba1617d521a1e`; 24 historical partitions; no DEFAULT partition; resolver/external identities absent; invalid/orphan rows zero. Any mismatch is STOP and reclassification, not an override.

## Backup and restore prerequisites

Rehearsal logical dump:

- confidential artefact: `~/.cache/nabuuma-target-rehearsal-20261123/approved-target.dump`
- format: PostgreSQL custom format
- size: 325,166 bytes
- mode: 0600
- SHA-256: `de33f2d2548164560d7b2e1bf93c1657c6f4e7d8a6b8c7273c845e7f49c76076`
- tool: PostgreSQL 18.2 `pg_dump` / `pg_restore` family
- restored once into a disposable PostgreSQL 18 clone successfully

This is rehearsal evidence, not a production backup policy. Before an authorised change, obtain a fresh approved backup and verify its checksum, access controls, restore point, restore command/options, role bootstrap, ownership semantics and post-restore validation. Role names/attributes needed by restore must exist or be bootstrapped; do not copy password hashes. The exact historical restore command was not preserved in this packet.

## Migration execution

Only after authority, backup, maintenance window, and preflight PASS. Use an approved migration identity, strict ordinal order, transactional source migrations, and stop on first error. Do not execute under `nabuuma_runtime`. Do not skip migration SQL or assertions.

## Read-only postflight

Run:

```sh
psql -X -w -v ON_ERROR_STOP=1 -f deployment/sql/approved-db-postconditions.sql
```

This manifest is read-only and fails closed. Verify all assertion output and record it. Then capture audit count, deterministic logical digest, min/max occurred_at, monthly partitions, DEFAULT partition, invalid/orphan rows and security canaries. Preservation requires before/after count and digest equality; digest is not a substitute for a byte-for-byte comparison if the approved verification method later provides one.

## Stop conditions

STOP immediately on target identity/version mismatch, baseline drift, missing/extra migration object, migration identity authority failure, backup/restore failure, SQL error, audit count/digest/timestamp change, invalid/orphan rows, unexpected partition/constraint/index/policy/trigger, privilege expansion, or any manifest assertion failure. No improvised manual repair on the approved target.

## Rollback semantics

Migration SQL uses transactions; a migration error before commit should roll back that migration's transaction. This is not a tested end-to-end rollback of the full sequence. Once committed, do not promise automatic reversal. Use separately approved forward remediation or restore from the verified recovery point under an approved recovery plan. Restore/rollback authority must be explicit.

## Application postflight

After authorised migration and approved runtime restart, check `/health/live`, `/health/ready`; unknown, valid, and revoked certificate verification; external identity resolution; and tenant isolation canaries. Runtime clone HTTP smoke was not executed: the production wrapper pins the approved port and no dedicated rehearsal-only launcher was present. Do not bypass that guard. Auth0 token matrix and mobile build/device callback are separate authority-gated work.

## Evidence and current decision

Target-specific clone rehearsal: VERIFIED. Audit preservation rehearsal: VERIFIED. Manifest was executed on the migrated clone before the latest additional invalid/orphan assertions; those latest assertions have static test coverage but were NOT EXECUTED against a clone. Read-only preflight against approved target: VERIFIED. Approved target mutation: NOT EXECUTED. Migration authority: NOT AUTHORISED.
