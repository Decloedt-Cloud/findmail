#!/bin/sh
# Fill stored channels until all YouTube units recorded for the current quota day
# reach 5000, including units matching already used, or until none are left.
# YouTube resets the quota at midnight Pacific. A later run the same day sees
# that total and stops.
#
# Crontab, 10 minutes after that reset. CRON_TZ keeps the hour on Pacific time
# whether the server clock is UTC or not:
#
#   CRON_TZ=America/Los_Angeles
#   10 0 * * * cd /var/www/findmail && /bin/sh scripts/backfill-languages-daily.sh >> /var/log/findmail-language-backfill.log 2>&1
set -eu
cd "$(dirname "$0")/.."
lot=200
budget=5000

while true; do
  if ! log=$(docker compose exec -T -e YOUTUBE_BACKFILL_QUOTA="$budget" web npm run db:backfill-languages -- "$lot" 2>&1); then
    printf '%s\n' "$log"
    exit 1
  fi
  printf '%s\n' "$log"
  if printf '%s\n' "$log" | grep -q "stopped: YouTube quota"; then
    exit 0
  fi
  if printf '%s\n' "$log" | grep -q "remaining: 0"; then
    exit 0
  fi
  if printf '%s\n' "$log" | grep -q "reading 0 of"; then
    exit 0
  fi
done
