#!/usr/bin/env bash
#
# copy-prod-to-dev.sh — one-time (repeatable) copy of Fintrack PROD data into the
# DEV / experimental Supabase project.
#
# PROD is only ever READ (pg_dump). DEV is reset and restored. The three auth
# tables keep their STRUCTURE but not their DATA — passkeys are bound to the prod
# RP_ID and can't authenticate on the dev domain, so their rows are dead weight.
#
# Usage:
#   PROD_5432="postgresql://postgres.<ref>:<pw>@<host>:5432/postgres" \
#   DEV_5432="postgresql://postgres.<ref>:<pw>@<host>:5432/postgres" \
#   ./scripts/copy-prod-to-dev.sh
#
# IMPORTANT:
#   * Use the SESSION / DIRECT connection strings (port 5432), NOT the 6543
#     transaction pooler — pgbouncer in transaction mode can't dump/restore.
#   * The script REFUSES to run if PROD and DEV resolve to the same Supabase
#     project ref. Never restore onto prod.

set -euo pipefail

: "${PROD_5432:?set PROD_5432 to the prod session/direct (5432) connection string}"
: "${DEV_5432:?set DEV_5432 to the dev  session/direct (5432) connection string}"

DUMP_FILE="${DUMP_FILE:-/tmp/fintrack_prod_$(date +%Y%m%d_%H%M%S).dump}"

# Auth tables: copy structure, exclude data.
AUTH_TABLES=(webauthn_credentials auth_sessions webauthn_challenges)

# --- Extract a Supabase project ref from a connection string ------------------
extract_ref() {
  local url="$1" ref
  # direct form: @db.<ref>.supabase.co
  ref=$(printf '%s' "$url" | sed -nE 's#.*@db\.([a-z0-9]+)\.supabase\.co.*#\1#p')
  [ -n "$ref" ] && { printf '%s' "$ref"; return; }
  # session/pooler form: //postgres.<ref>:...@
  ref=$(printf '%s' "$url" | sed -nE 's#.*//postgres\.([a-z0-9]+):.*#\1#p')
  [ -n "$ref" ] && { printf '%s' "$ref"; return; }
  # fallback: the raw host
  printf '%s' "$url" | sed -nE 's#.*@([^/:]+).*#\1#p'
}

PROD_REF=$(extract_ref "$PROD_5432")
DEV_REF=$(extract_ref "$DEV_5432")

echo "PROD project ref: ${PROD_REF:-<unparsed>}"
echo "DEV  project ref: ${DEV_REF:-<unparsed>}"

if [ -z "$PROD_REF" ] || [ -z "$DEV_REF" ]; then
  echo "ERROR: could not parse a project ref from one of the URLs — aborting for safety." >&2
  exit 1
fi
if [ "$PROD_REF" = "$DEV_REF" ]; then
  echo "REFUSING: PROD and DEV point at the SAME project ($PROD_REF). Never restore onto prod." >&2
  exit 1
fi

# Warn (don't fail) if a URL looks like the 6543 transaction pooler.
case "$PROD_5432$DEV_5432" in
  *:6543*) echo "WARNING: a URL uses port 6543 (transaction pooler). Dump/restore needs the 5432 session/direct port." >&2 ;;
esac

# --- 1. Dump prod (READ-ONLY) -------------------------------------------------
echo ">> Dumping prod public schema (auth-table data excluded) -> $DUMP_FILE"
EXCLUDES=()
for t in "${AUTH_TABLES[@]}"; do EXCLUDES+=(--exclude-table-data="$t"); done

pg_dump "$PROD_5432" --format=custom --no-owner --no-privileges --schema=public \
  "${EXCLUDES[@]}" -f "$DUMP_FILE"
echo ">> Dump complete ($(du -h "$DUMP_FILE" | cut -f1))."

# --- 2. Restore into dev ------------------------------------------------------
echo ">> Restoring into DEV ($DEV_REF) — dropping & recreating objects..."
# --clean --if-exists makes a re-run idempotent. Extension/ownership NOTICEs are
# expected on Supabase and non-fatal, so we don't pass --exit-on-error.
pg_restore "$DEV_5432" --no-owner --no-privileges --clean --if-exists "$DUMP_FILE" || \
  echo ">> pg_restore returned non-zero (usually ignorable extension/ownership NOTICEs) — continuing to verify." >&2

# --- 3. Verify ----------------------------------------------------------------
echo ">> Verifying row counts (prod vs dev) for every public table..."
PROD_COUNTS=$(mktemp); DEV_COUNTS=$(mktemp)
trap 'rm -f "$PROD_COUNTS" "$DEV_COUNTS"' EXIT

count_tables() {
  local url="$1" inner
  inner=$(psql "$url" -Atc \
    "SELECT string_agg(format('SELECT %L AS t, count(*) AS c FROM %I', table_name, table_name), ' UNION ALL ')
       FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE'")
  [ -z "$inner" ] && return 0
  psql "$url" -Atc "SELECT t||'|'||c FROM ($inner) s ORDER BY t"
}

count_tables "$PROD_5432" | sort -t'|' -k1,1 > "$PROD_COUNTS"
count_tables "$DEV_5432"  | sort -t'|' -k1,1 > "$DEV_COUNTS"

printf '%-34s %12s %12s   %s\n' "table" "prod" "dev" "status"
printf '%-34s %12s %12s   %s\n' "-----" "----" "---" "------"
join -t'|' -a1 -a2 -e '-' -o '0,1.2,2.2' "$PROD_COUNTS" "$DEV_COUNTS" \
| while IFS='|' read -r tbl p d; do
    status="ok"
    if printf '%s\n' "${AUTH_TABLES[@]}" | grep -qx "$tbl"; then
      [ "$d" = "0" ] && status="auth: empty ✓" || status="auth: NOT empty ✗"
    elif [ "$p" != "$d" ]; then
      status="MISMATCH ✗"
    fi
    printf '%-34s %12s %12s   %s\n' "$tbl" "$p" "$d" "$status"
  done

echo ">> Done. Review any MISMATCH / auth-NOT-empty rows above."
