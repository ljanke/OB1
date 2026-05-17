#!/bin/bash
# Create the two application roles using passwords passed in via env vars.
# Runs first (alphabetical order) so 01-schema.sql can grant to existing roles.
#
# Passwords are passed to psql via --set and substituted with :'var' (which
# auto-quotes and escapes) rather than interpolated into the SQL text via
# bash. This means passwords containing single quotes, backslashes, or other
# SQL-special characters work correctly.
#
# Note: docker-entrypoint-initdb.d scripts run only on a freshly-initialized
# data directory, so plain CREATE ROLE is sufficient — there's no prior
# state to reconcile. To re-create roles, run `docker compose down -v` to
# wipe the volume and let init re-run.
set -euo pipefail

: "${OPENBRAIN_APP_PASSWORD:?OPENBRAIN_APP_PASSWORD must be set in compose env}"
: "${OPENBRAIN_READONLY_PASSWORD:?OPENBRAIN_READONLY_PASSWORD must be set in compose env}"

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=app_password="$OPENBRAIN_APP_PASSWORD" \
  --set=readonly_password="$OPENBRAIN_READONLY_PASSWORD" \
  <<-'EOSQL'
  CREATE ROLE openbrain_app LOGIN PASSWORD :'app_password';
  CREATE ROLE openbrain_readonly LOGIN PASSWORD :'readonly_password';
EOSQL
