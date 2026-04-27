#!/usr/bin/env bash
# Apply a migration file to the hosted Supabase DB via the Management API.
# Needs SUPABASE_ACCESS_TOKEN exported (personal access token from
# https://supabase.com/dashboard/account/tokens).
#
# Usage:
#   ./supabase/apply-migration.sh supabase/migrations/20260418_create_user_systems.sql

set -euo pipefail

PROJECT_REF="ilsgdshkaocrmibwdezk"
MIGRATION_FILE="${1:-}"

if [[ -z "${MIGRATION_FILE}" ]]; then
  echo "usage: $0 <path-to-migration.sql>" >&2
  exit 1
fi

if [[ ! -f "${MIGRATION_FILE}" ]]; then
  echo "error: file not found: ${MIGRATION_FILE}" >&2
  exit 1
fi

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "error: SUPABASE_ACCESS_TOKEN is not set" >&2
  echo "get one from https://supabase.com/dashboard/account/tokens" >&2
  exit 1
fi

# Read the SQL and JSON-encode it with jq (safer than ad-hoc escaping)
if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required" >&2
  exit 1
fi

PAYLOAD=$(jq -Rs '{query: .}' < "${MIGRATION_FILE}")

echo "Applying ${MIGRATION_FILE} to project ${PROJECT_REF}..."
HTTP_CODE=$(curl -sS -o /tmp/supabase-apply.out -w "%{http_code}" \
  -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "${PAYLOAD}")

if [[ "${HTTP_CODE}" != "200" && "${HTTP_CODE}" != "201" ]]; then
  echo "HTTP ${HTTP_CODE}" >&2
  cat /tmp/supabase-apply.out >&2
  exit 1
fi

echo "OK"
cat /tmp/supabase-apply.out
echo
