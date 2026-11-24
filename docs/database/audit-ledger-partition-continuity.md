# Audit ledger partition continuity

Migration `00022_reconcile_audit_ledger_architecture.sql` establishes `RANGE (occurred_at)` partitioning, the catalogue-evidenced monthly horizon (2026-10 through 2028-09), and a `DEFAULT` partition. The DEFAULT partition is the write-continuity safety net for records outside the monthly horizon; no finite partition cliff is permitted.

## Provisioning future monthly partitions

For a future month that currently has no rows in DEFAULT, create the monthly child with the exact range bounds, then attach it. PostgreSQL validates that the new range does not overlap existing partitions and that DEFAULT contains no rows in the attached range. If DEFAULT contains rows for that month, ATTACH fails closed rather than moving audit history.

## Existing DEFAULT rows

Do not move append-only audit history as routine partition maintenance. Historical rows in DEFAULT remain valid. Any exceptional archival/repartitioning operation requires an owner-controlled, isolated maintenance transaction, a complete source snapshot, exact bidirectional `EXCEPT ALL` equality, and post-operation RLS/FORCE-RLS/trigger/constraint verification. Never fabricate or alter audit values. The default partition remains available throughout normal writes.
