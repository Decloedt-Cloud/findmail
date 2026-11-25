#!/bin/sh
# Rebuild the running services, then drop the cache the previous build left behind.
# The cache this build just wrote stays, so the next deploy can reuse it.
set -eu
cd "$(dirname "$0")/.."
docker compose up -d --build web worker
docker builder prune -f
