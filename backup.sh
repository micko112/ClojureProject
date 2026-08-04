#!/usr/bin/env bash
# Nightly backup of the Datomic H2 storage volume + uploads.
# Add to crontab on the VPS:
#   0 2 * * * /opt/app/backup.sh >> /opt/app/backups/backup.log 2>&1

set -euo pipefail

BACKUP_DIR="/opt/app/backups"
DAYS_TO_KEEP=14
DATE=$(date +"%Y-%m-%d_%H-%M-%S")

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Backup starting"

# ─── Datomic storage (H2 files under /var/lib/datomic) ──────────────────────
# We snapshot the volume via a throwaway container that mounts it read-only.
DATOMIC_BACKUP="$BACKUP_DIR/datomic_${DATE}.tar.gz"
docker run --rm \
  -v bebetter_datomic_data:/data:ro \
  -v "$BACKUP_DIR":/backup \
  alpine sh -c "tar czf /backup/datomic_${DATE}.tar.gz -C /data ."
echo "[$(date)] Wrote $DATOMIC_BACKUP ($(du -sh "$DATOMIC_BACKUP" | cut -f1))"

# ─── Uploaded media ──────────────────────────────────────────────────────────
UPLOADS_BACKUP="$BACKUP_DIR/uploads_${DATE}.tar.gz"
docker run --rm \
  -v bebetter_uploads_data:/data:ro \
  -v "$BACKUP_DIR":/backup \
  alpine sh -c "tar czf /backup/uploads_${DATE}.tar.gz -C /data ."
echo "[$(date)] Wrote $UPLOADS_BACKUP ($(du -sh "$UPLOADS_BACKUP" | cut -f1))"

# ─── Retention ───────────────────────────────────────────────────────────────
find "$BACKUP_DIR" -name "datomic_*.tar.gz" -mtime "+$DAYS_TO_KEEP" -delete
find "$BACKUP_DIR" -name "uploads_*.tar.gz" -mtime "+$DAYS_TO_KEEP" -delete
echo "[$(date)] Cleanup done. Keeping last $DAYS_TO_KEEP days."
