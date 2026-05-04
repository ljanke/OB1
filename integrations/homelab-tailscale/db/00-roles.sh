#!/bin/bash
# Create the two application roles using passwords passed in via env vars.
# Runs first (alphabetical order) so 01-schema.sql can grant to existing roles.
set -euo pipefail

: "${OPENBRAIN_APP_PASSWORD:?OPENBRAIN_APP_PASSWORD must be set in compose env}"
: "${OPENBRAIN_READONLY_PASSWORD:?OPENBRAIN_READONLY_PASSWORD must be set in compose env}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'openbrain_app') THEN
      CREATE ROLE openbrain_app LOGIN PASSWORD '${OPENBRAIN_APP_PASSWORD}';
    ELSE
      ALTER ROLE openbrain_app WITH LOGIN PASSWORD '${OPENBRAIN_APP_PASSWORD}';
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'openbrain_readonly') THEN
      CREATE ROLE openbrain_readonly LOGIN PASSWORD '${OPENBRAIN_READONLY_PASSWORD}';
    ELSE
      ALTER ROLE openbrain_readonly WITH LOGIN PASSWORD '${OPENBRAIN_READONLY_PASSWORD}';
    END IF;
  END
  \$\$;
EOSQL
