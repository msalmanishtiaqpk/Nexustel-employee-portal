#!/bin/sh
set -e
# Apply pending migrations on every start (idempotent), then seed core data once.
./node_modules/.bin/prisma migrate deploy
if [ "${RUN_SEED:-true}" = "true" ]; then
  ./node_modules/.bin/tsx prisma/seed.ts || echo "seed skipped/failed (non-fatal)"
fi
exec "$@"
