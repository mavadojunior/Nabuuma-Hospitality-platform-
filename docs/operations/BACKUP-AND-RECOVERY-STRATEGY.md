# Nabuuma Backup and Recovery Strategy

Local PostgreSQL custom-format backup via scripts/backup-postgres.sh; archive listing validation, SHA-256 and metadata. Archive includes object ownership and ACLs; global roles are not included and must be provisioned separately. Local copy is not independent recovery.

Encrypted off-device copy: use standard audited encryption or provider encryption; never custom cryptography. Keep key separate from backup and repository. Verify checksum after transfer. Access limited to authorized recovery operator.

Retention proposal for synthetic pilot only: daily 7 days, weekly 4 weeks, subject to owner/privacy review. Not a policy for real personal data.

Restore drill: checksum/list; bootstrap global roles in NEW recovery cluster; create NEW empty disposable DB; restore; compare row counts/data digests/table owners/RLS/FORCE/policies/triggers/function definitions/SECURITY DEFINER/search_path/owners/ACL/schema ACL/partition bounds; audit partitions; resolver/verifier; runtime direct-table denial and approved-function execution; app/security tests; record timing; destroy only disposable DBs.

Role bootstrap is idempotent and creates no login credentials. Use only in a new recovery cluster. Restore archive preserving owner/ACL; roles must exist.

Key separation: DB credentials private; backup key separate; provider credentials separate; rotate after exposure. Never commit backups, keys, runtime.env, connection strings or tokens.

Logical dumps exclude server config, networking, external object storage and cluster-wide roles. Restore must provision those separately. A backup not restored is not verified.
