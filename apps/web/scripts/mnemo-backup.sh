#!/bin/bash
# MNEMO brain backup + restore.
#
#   backup           dump Postgres + archive photos into a timestamped, rotated backup
#   restore <dir>    DESTRUCTIVE: restore the DB + photos from a backup directory
#
# Backups live outside the repo ($HOME/MNEMO-Backups by default) and, if iCloud Drive is
# present, the newest is mirrored there for off-machine durability. They contain PRIVATE
# content (your photos + encrypted bodies), so the backup root is locked to 0700.
set -euo pipefail
export PATH="/opt/homebrew/opt/postgresql@16/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BACKUP_ROOT="${MNEMO_BACKUP_DIR:-$HOME/MNEMO-Backups}"
ICLOUD_MIRROR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/MNEMO-Backups"
KEEP=14

# DATABASE_URL comes straight from .env (pg_dump/pg_restore accept the URL form).
set -a; [ -f "$REPO/.env" ] && . "$REPO/.env"; set +a
DB="${DATABASE_URL:?DATABASE_URL not set in .env}"

do_backup() {
  mkdir -p "$BACKUP_ROOT"; chmod 700 "$BACKUP_ROOT"
  local ts dest; ts="$(date +%Y%m%d-%H%M%S)"; dest="$BACKUP_ROOT/mnemo-$ts"
  mkdir -p "$dest"

  echo "• dumping database…"
  # custom format = compressed and supports selective/clean restore
  pg_dump --no-owner --format=custom --file="$dest/db.dump" "$DB"

  if [ -d "$REPO/data/photos" ] && [ -n "$(ls -A "$REPO/data/photos" 2>/dev/null || true)" ]; then
    echo "• archiving photos…"
    tar -czf "$dest/photos.tar.gz" -C "$REPO/data" photos
  fi

  { echo "created: $(date -Iseconds)"; pg_dump --version; } > "$dest/MANIFEST.txt" 2>/dev/null || true
  ( cd "$dest" && shasum -a 256 ./* > SHA256SUMS 2>/dev/null || true )

  # rotate — keep the newest $KEEP
  # shellcheck disable=SC2012
  ls -1dt "$BACKUP_ROOT"/mnemo-* 2>/dev/null | tail -n "+$((KEEP + 1))" | while read -r old; do rm -rf "$old"; done

  # off-machine mirror (newest only) if iCloud Drive exists
  if [ -d "$(dirname "$ICLOUD_MIRROR")" ]; then
    mkdir -p "$ICLOUD_MIRROR/latest"
    rsync -a --delete "$dest/" "$ICLOUD_MIRROR/latest/" 2>/dev/null \
      || cp -Rf "$dest/." "$ICLOUD_MIRROR/latest/" 2>/dev/null || true
  fi

  echo "✓ backup → $dest  ($(du -sh "$dest" 2>/dev/null | awk '{print $1}'))"
}

do_restore() {
  local src="$1"
  [ -d "$src" ] || { echo "✗ no such backup dir: $src"; exit 1; }
  [ -f "$src/db.dump" ] || { echo "✗ $src/db.dump not found"; exit 1; }
  echo "!! This OVERWRITES the live brain from: $src"
  read -r -p "   Type 'restore' to proceed: " ans
  [ "$ans" = "restore" ] || { echo "aborted."; exit 1; }

  echo "• restoring database…"
  pg_restore --clean --if-exists --no-owner --dbname "$DB" "$src/db.dump"
  if [ -f "$src/photos.tar.gz" ]; then
    echo "• restoring photos…"
    mkdir -p "$REPO/data"
    tar -xzf "$src/photos.tar.gz" -C "$REPO/data"
  fi
  echo "✓ restored. Restart MNEMO:  pnpm mnemo restart"
}

case "${1:-backup}" in
  backup)  do_backup ;;
  restore) do_restore "${2:-}" ;;
  *) echo "usage: mnemo-backup.sh <backup|restore <dir>>"; exit 1 ;;
esac
