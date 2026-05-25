#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/hxmm-postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges --file "$BACKUP_DIR/hxmm-$TIMESTAMP.dump"
gzip -f "$BACKUP_DIR/hxmm-$TIMESTAMP.dump"
find "$BACKUP_DIR" -type f -name 'hxmm-*.dump.gz' -mtime +"$RETENTION_DAYS" -delete

echo "Backup created: $BACKUP_DIR/hxmm-$TIMESTAMP.dump.gz"