#!/bin/sh
# Rebuild the running services, then drop the cache the previous build left behind.
# The cache this build just wrote stays, so the next deploy can reuse it.
set -eu
cd "$(dirname "$0")/.."
docker compose build web worker
docker compose run --rm --no-deps web npx prisma migrate deploy
docker compose up -d web worker
docker builder prune -f
