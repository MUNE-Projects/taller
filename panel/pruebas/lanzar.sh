#!/usr/bin/env bash
# Prueba de aislamiento en local: Supabase vacío → archivos SQL → comprobaciones.
# Uso, desde panel/: bash pruebas/lanzar.sh   (necesita Docker y psql)
set -euo pipefail
cd "$(dirname "$0")"
CLI="npx --yes supabase@2.120.0"
$CLI stop --no-backup >/dev/null 2>&1 || true
$CLI start >/dev/null
eval "$($CLI status -o env 2>/dev/null)"
cd ..
SUPABASE_URL="$API_URL" SUPABASE_ANON_KEY="$ANON_KEY" SUPABASE_SERVICE_KEY="$SERVICE_ROLE_KEY" DB_URL="$DB_URL" \
	node pruebas/aislamiento.mjs
