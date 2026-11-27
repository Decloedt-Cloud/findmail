#!/bin/sh
# Fill stored channels until all YouTube units recorded for the current quota day
# reach the day's budget, including units matching already used, or until none
# are left. Saturday and Sunday allow 9000. Monday through Friday allow 5000.
# YouTube resets the quota at midnight Pacific. A later run the same day sees
# that total and stops.
#
# The server clock is UTC. This job runs at 08:10 UTC, ten minutes after midnight
# Pacific in winter, so the weekday below is the quota day:
#
#   10 8 * * * cd /var/www/findmail && /bin/sh scripts/backfill-languages-daily.sh >> /var/log/findmail-language-backfill.log 2>&1
set -eu
cd "$(dirname "$0")/.."
lot=200
# 1 = Monday … 7 = Sunday.
day=$(date +%u)
if [ "$day" -ge 6 ]; then
  budget=9000
else
  budget=5000
fi
printf 'backfill budget: %s\n' "$budget"

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
