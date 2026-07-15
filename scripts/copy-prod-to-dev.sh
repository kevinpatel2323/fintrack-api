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
#   * The script REFUSES to run if PROD and DEV resolve to the same target.
#     Never restore onto prod.
#   * Passwords may contain '@' / ':' — URLs are parsed on the LAST '@' and the
#     password is passed via PGPASSWORD (never through the URI), so no manual
#     percent-encoding is needed.

set -euo pipefail

: "${PROD_5432:?set PROD_5432 to the prod session/direct (5432) connection string}"
: "${DEV_5432:?set DEV_5432 to the dev  session/direct (5432) connection string}"

DUMP_FILE="${DUMP_FILE:-/tmp/fintrack_prod_$(date +%Y%m%d_%H%M%S).dump}"

# pg_dump/pg_restore must be >= the Supabase server major (PG17). If the default
# client on PATH is older, prefer an unlinked Homebrew keg (postgresql@17/@16).
_pgmajor() { "$1" --version 2>/dev/null | grep -oE '[0-9]+' | head -1; }
if [ "$(_pgmajor pg_dump || echo 0)" -lt 17 ] 2>/dev/null; then
  for v in 18 17; do
    cand="/opt/homebrew/opt/postgresql@$v/bin"
    if [ -x "$cand/pg_dump" ]; then PATH="$cand:$PATH"; break; fi
  done
fi

# Auth tables: copy structure, exclude data.
AUTH_TABLES=(webauthn_credentials auth_sessions webauthn_challenges)

# Parse a postgres:// URL into PREFIX_HOST/_PORT/_USER/_PASS/_DB/_REF. Robust to
# '@' and ':' in the password: authority is split on the LAST '@', user/pass on
# the FIRST ':'.
parse_pg_url() {
  local url="$1" pfx="$2" rest userinfo hostportdb hostport host port user pass db ref
  rest=${url#*://}
  userinfo=${rest%@*}          # before last @  -> user:pass
  hostportdb=${rest##*@}       # after  last @  -> host:port/db
  user=${userinfo%%:*}
  pass=${userinfo#*:}
  hostport=${hostportdb%%/*}
  db=${hostportdb#*/}; db=${db%%\?*}
  [ "$db" = "$hostportdb" ] && db=postgres
  host=${hostport%%:*}
  port=${hostport#*:}; [ "$port" = "$host" ] && port=5432
  ref=${user#postgres.}
  printf -v "${pfx}_HOST" '%s' "$host"
  printf -v "${pfx}_PORT" '%s' "$port"
  printf -v "${pfx}_USER" '%s' "$user"
  printf -v "${pfx}_PASS" '%s' "$pass"
  printf -v "${pfx}_DB"   '%s' "$db"
  printf -v "${pfx}_REF"  '%s' "$ref"
}

parse_pg_url "$PROD_5432" PROD
parse_pg_url "$DEV_5432"  DEV

echo "PROD: host=$PROD_HOST port=$PROD_PORT user=$PROD_USER db=$PROD_DB ref=${PROD_REF:-<none>}"
echo "DEV : host=$DEV_HOST port=$DEV_PORT user=$DEV_USER db=$DEV_DB ref=${DEV_REF:-<none>}"

# --- Guard: never restore onto prod ------------------------------------------
if [ -z "$PROD_HOST" ] || [ -z "$DEV_HOST" ]; then
  echo "ERROR: could not parse a host from one of the URLs — aborting." >&2; exit 1
fi
if { [ -n "$PROD_REF" ] && [ "$PROD_REF" = "$DEV_REF" ]; } \
   || { [ "$PROD_HOST" = "$DEV_HOST" ] && [ "$PROD_USER" = "$DEV_USER" ]; }; then
  echo "REFUSING: PROD and DEV resolve to the SAME target. Never restore onto prod." >&2; exit 1
fi
case "$PROD_PORT/$DEV_PORT" in
  *6543*) echo "WARNING: a URL uses port 6543 (transaction pooler); dump/restore needs 5432." >&2 ;;
esac

# --- 1. Dump prod (READ-ONLY) -------------------------------------------------
echo ">> Dumping prod public schema (auth-table data excluded) -> $DUMP_FILE"
EXCLUDES=()
for t in "${AUTH_TABLES[@]}"; do EXCLUDES+=(--exclude-table-data="$t"); done
PGPASSWORD="$PROD_PASS" pg_dump -h "$PROD_HOST" -p "$PROD_PORT" -U "$PROD_USER" -d "$PROD_DB" \
  --format=custom --no-owner --no-privileges --schema=public "${EXCLUDES[@]}" -f "$DUMP_FILE"
echo ">> Dump complete ($(du -h "$DUMP_FILE" | cut -f1))."

# --- 2. Restore into dev ------------------------------------------------------
echo ">> Restoring into DEV (${DEV_REF:-$DEV_HOST}) — dropping & recreating objects..."
# --clean --if-exists makes re-runs idempotent. Extension/ownership NOTICEs are
# expected on Supabase and non-fatal, so we don't pass --exit-on-error.
PGPASSWORD="$DEV_PASS" pg_restore -h "$DEV_HOST" -p "$DEV_PORT" -U "$DEV_USER" -d "$DEV_DB" \
  --no-owner --no-privileges --clean --if-exists "$DUMP_FILE" || \
  echo ">> pg_restore returned non-zero (usually ignorable extension/ownership NOTICEs) — continuing to verify." >&2

# --- 3. Verify ----------------------------------------------------------------
echo ">> Verifying row counts (prod vs dev) for every public table..."
PROD_COUNTS=$(mktemp); DEV_COUNTS=$(mktemp)
trap 'rm -f "$PROD_COUNTS" "$DEV_COUNTS"' EXIT

count_tables() {  # $1=prefix
  local pfx="$1" host port user pass db inner
  host="${pfx}_HOST"; port="${pfx}_PORT"; user="${pfx}_USER"; pass="${pfx}_PASS"; db="${pfx}_DB"
  inner=$(PGPASSWORD="${!pass}" psql -h "${!host}" -p "${!port}" -U "${!user}" -d "${!db}" -Atc \
    "SELECT string_agg(format('SELECT %L AS t, count(*) AS c FROM %I', table_name, table_name), ' UNION ALL ')
       FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE'")
  [ -z "$inner" ] && return 0
  PGPASSWORD="${!pass}" psql -h "${!host}" -p "${!port}" -U "${!user}" -d "${!db}" -Atc \
    "SELECT t||'|'||c FROM ($inner) s ORDER BY t"
}

count_tables PROD | sort -t'|' -k1,1 > "$PROD_COUNTS"
count_tables DEV  | sort -t'|' -k1,1 > "$DEV_COUNTS"

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
