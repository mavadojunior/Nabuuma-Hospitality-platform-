#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Local logical backup. Owners and ACLs are retained in the archive.
# Global roles are not included by pg_dump and must be provisioned separately.
# DATABASE_URL must come from a private runtime configuration, not argv.

if [[ -z "$DATABASE_URL" ]]; then
  echo "ERROR: DATABASE_URL is not set. Load it from a private runtime configuration." >&2
  exit 2
fi
for cmd in pg_dump pg_restore sha256sum; do
  command -v "$cmd" >/dev/null || { echo "ERROR: Required command not found: $cmd" >&2; exit 2; }
done

if [[ -v BACKUP_DIR && -n "$BACKUP_DIR" ]]; then backup_dir="$BACKUP_DIR"; else backup_dir="$HOME/nabuuma-backups"; fi
if [[ -z "$backup_dir" ]]; then backup_dir="$HOME/nabuuma-backups"; fi
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
final_file="$backup_dir/nabuuma-postgres-$timestamp.dump"
temp_file="$final_file.partial"
checksum_file="$final_file.sha256"
metadata_file="$final_file.metadata.txt"

cleanup() { [[ ! -f "$temp_file" ]] || rm -f "$temp_file"; }
trap cleanup EXIT

if [[ -e "$final_file" || -e "$checksum_file" || -e "$metadata_file" ]]; then
  echo "ERROR: Backup destination already exists; refusing to overwrite." >&2
  exit 3
fi

echo "Creating PostgreSQL custom-format backup..."
pg_dump --format=custom --file="$temp_file" "$DATABASE_URL"
echo "Validating archive listing..."
pg_restore --list "$temp_file" >/dev/null

mv "$temp_file" "$final_file"
chmod 600 "$final_file"
sha256sum "$final_file" > "$checksum_file"
chmod 600 "$checksum_file"

{
  printf 'created_utc=%s\n' "$timestamp"
  printf 'archive=%s\n' "$(basename "$final_file")"
  printf 'archive_size_bytes=%s\n' "$(wc -c < "$final_file" | tr -d ' ')"
  printf 'pg_dump_version=%s\n' "$(pg_dump --version)"
  printf 'archive_validation=pg_restore --list PASS\n'
  printf 'checksum_file=%s\n' "$(basename "$checksum_file")"
  printf 'backup_scope=database logical dump including object ownership and ACLs\n'
  printf 'global_roles=not included; provision roles before restore\n'
  printf 'storage_scope=local only; independent off-device copy not performed\n'
} > "$metadata_file"
chmod 600 "$metadata_file"

echo "Backup created and archive-list validation passed:"
echo "$final_file"
echo "Checksum:"
cat "$checksum_file"
echo "IMPORTANT: Local backup only. Copy securely to an independent location and test restore."
