#!/bin/sh
set -e

echo "[entrypoint] applying database migrations…"
npx prisma migrate deploy

echo "[entrypoint] seeding first admin (only if no users exist)…"
npm run db:seed || echo "[entrypoint] seed skipped/failed (non-fatal)"

echo "[entrypoint] starting backend…"
exec node dist/main.js
