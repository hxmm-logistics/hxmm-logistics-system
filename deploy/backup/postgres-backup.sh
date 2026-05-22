#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/hxmm-postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
DATABASE_URL="${DATABASE_URL:?DATABASE_URL is required}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

timestamp="$(date +%Y%m%d-%H%M%S)"
backup_file="$BACKUP_DIR/hxmm-$timestamp.sql.gz"

pg_dump "$DATABASE_URL" | gzip > "$backup_file"
chmod 600 "$backup_file"

find "$BACKUP_DIR" -type f -name 'hxmm-*.sql.gz' -mtime +"$RETENTION_DAYS" -delete

echo "Backup created: $backup_file"
