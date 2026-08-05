#!/usr/bin/env sh
set -eu

umask 077
ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BACKUP_DIR=${BACKUP_DIR:-"$ROOT_DIR/backups"}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
PLAIN_FILE="$BACKUP_DIR/touji-$STAMP.dump"

mkdir -p "$BACKUP_DIR"
cd "$ROOT_DIR"

docker compose exec -T db sh -c 'exec pg_dump --format=custom --no-owner --no-privileges --username="$POSTGRES_USER" "$POSTGRES_DB"' > "$PLAIN_FILE"
docker compose exec -T db sh -c 'exec pg_restore --list' < "$PLAIN_FILE" > /dev/null

if [ -n "${AGE_RECIPIENT:-}" ]; then
  command -v age > /dev/null 2>&1 || {
    echo "AGE_RECIPIENT is set but the age command is not installed" >&2
    exit 1
  }
  age -r "$AGE_RECIPIENT" -o "$PLAIN_FILE.age" "$PLAIN_FILE"
  rm -f "$PLAIN_FILE"
  FINAL_FILE="$PLAIN_FILE.age"
else
  FINAL_FILE="$PLAIN_FILE"
fi

find "$BACKUP_DIR" -type f \( -name 'touji-*.dump' -o -name 'touji-*.dump.age' \) -mtime +14 -delete
echo "$FINAL_FILE"
