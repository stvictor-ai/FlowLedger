#!/usr/bin/env sh
set -eu

if [ "${CONFIRM_RESTORE:-}" != "YES" ]; then
  echo "Restore replaces the current database. Re-run with CONFIRM_RESTORE=YES." >&2
  exit 1
fi
if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
  echo "Usage: CONFIRM_RESTORE=YES ops/restore-postgres.sh backups/touji-YYYYMMDDTHHMMSSZ.dump" >&2
  exit 1
fi

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BACKUP_FILE=$(CDPATH= cd -- "$(dirname -- "$1")" && pwd)/$(basename -- "$1")
cd "$ROOT_DIR"

case "$BACKUP_FILE" in
  *.age)
    command -v age > /dev/null 2>&1 || { echo "The age command is required" >&2; exit 1; }
    TEMP_FILE=$(mktemp)
    trap 'rm -f "$TEMP_FILE"; docker compose start api > /dev/null 2>&1 || true' EXIT
    age -d -o "$TEMP_FILE" "$BACKUP_FILE"
    RESTORE_FILE="$TEMP_FILE"
    ;;
  *)
    trap 'docker compose start api > /dev/null 2>&1 || true' EXIT
    RESTORE_FILE="$BACKUP_FILE"
    ;;
esac

docker compose stop api
docker compose exec -T db sh -c 'exec pg_restore --clean --if-exists --no-owner --no-privileges --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' < "$RESTORE_FILE"
docker compose start api
echo "Restore completed from $BACKUP_FILE"
