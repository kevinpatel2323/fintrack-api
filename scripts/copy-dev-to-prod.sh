#!/usr/bin/env bash
#
# copy-dev-to-prod.sh — append DEV rows that PROD is missing, into PROD.
#
# The mirror image of copy-prod-to-dev.sh, and deliberately *not* symmetric with
# it: that script resets its target, this one must never do that. PROD is only
# ever appended to. Every INSERT carries ON CONFLICT DO NOTHING, so:
#
#   * rows PROD already has are left exactly as they are,
#   * rows only PROD has are never touched,
#   * the whole script is idempotent and safe to re-run.
#
# It does NOT migrate schema. Run `migration:run` against prod first — the
# tables/columns being filled here have to already exist.
#
# Usage:
#   DEV_5432="postgresql://postgres.<ref>:<pw>@<host>:5432/postgres" \
#   PROD_5432="postgresql://postgres.<ref>:<pw>@<host>:5432/postgres" \
#   ./scripts/copy-dev-to-prod.sh [--dry-run|--verify]
#
#   --dry-run   dump and report what WOULD be inserted; writes nothing
#   --verify    compare both sides row-by-row; writes nothing
#
# IMPORTANT:
#   * Use the SESSION / DIRECT connection strings (port 5432), NOT the 6543
#     transaction pooler — pgbouncer in transaction mode can't dump/restore.
#   * Passwords may contain '@' / ':' — URLs are parsed on the LAST '@' and the
#     password is passed via PGPASSWORD (never through the URI), so no manual
#     percent-encoding is needed.
#   * The script REFUSES to run if the two URLs resolve to the same target, or
#     if the TARGET looks like the dev project (guards against reversed args).

set -euo pipefail

: "${DEV_5432:?set DEV_5432 to the dev  session/direct (5432) connection string}"
: "${PROD_5432:?set PROD_5432 to the prod session/direct (5432) connection string}"

MODE="apply"
case "${1:-}" in
  --dry-run) MODE="dry-run" ;;
  --verify)  MODE="verify" ;;
  "")        ;;
  *) echo "unknown argument: $1 (expected --dry-run or --verify)" >&2; exit 2 ;;
esac

WORK_DIR="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/fintrack_sync_XXXXXX")}"
SQL_FILE="$WORK_DIR/insert.sql"

# Refuse to write to this project ref even if it is passed as the target. This
# is the dev database; if it shows up as PROD_5432 the arguments were swapped.
FORBID_TARGET_REF="${FORBID_TARGET_REF:-sbuvueyqwdaidnmcsnym}"

# Tables to sync, in FOREIGN KEY order — parents before children. pg_dump does
# not honour the order of repeated --table flags, so each table is dumped
# separately and concatenated in this order.
SYNC_TABLES=(
  accounts
  categories
  cards
  friends
  statement_imports
  transactions
  card_statements
  card_statement_imports
  card_payments
  card_transactions
  transaction_friend_tags
  settlement_links
  subscriptions
  transaction_invoices
)

# Never synced. `migrations` is per-database bookkeeping owned by TypeORM, and
# passkeys are bound to their origin's RP_ID — dev credentials cannot
# authenticate against prod, so copying them would only add dead rows (and
# sessions are short-lived secrets that have no business being copied at all).
SKIP_TABLES=(migrations webauthn_credentials auth_sessions webauthn_challenges)

# pg_dump/psql must be >= the Supabase server major (PG17). If the default
# client on PATH is older, prefer an unlinked Homebrew keg (postgresql@18/@17).
_pgmajor() { "$1" --version 2>/dev/null | grep -oE '[0-9]+' | head -1; }
if [ "$(_pgmajor pg_dump || echo 0)" -lt 17 ] 2>/dev/null; then
  for v in 18 17; do
    cand="/opt/homebrew/opt/postgresql@$v/bin"
    if [ -x "$cand/pg_dump" ]; then PATH="$cand:$PATH"; break; fi
  done
fi

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

parse_pg_url "$DEV_5432"  SRC
parse_pg_url "$PROD_5432" DST

echo "SOURCE (dev) : host=$SRC_HOST port=$SRC_PORT user=$SRC_USER db=$SRC_DB ref=${SRC_REF:-<none>}"
echo "TARGET (prod): host=$DST_HOST port=$DST_PORT user=$DST_USER db=$DST_DB ref=${DST_REF:-<none>}"
echo "MODE         : $MODE"

# --- Guards -------------------------------------------------------------------
if [ -z "$SRC_HOST" ] || [ -z "$DST_HOST" ]; then
  echo "ERROR: could not parse a host from one of the URLs — aborting." >&2; exit 1
fi
if { [ -n "$SRC_REF" ] && [ "$SRC_REF" = "$DST_REF" ]; } \
   || { [ "$SRC_HOST" = "$DST_HOST" ] && [ "$SRC_USER" = "$DST_USER" ]; }; then
  echo "REFUSING: source and target resolve to the SAME database." >&2; exit 1
fi
if [ -n "$FORBID_TARGET_REF" ] && [ "$DST_REF" = "$FORBID_TARGET_REF" ]; then
  echo "REFUSING: target ref '$DST_REF' is the DEV project — arguments look reversed." >&2
  echo "          This script only ever writes to prod. See copy-prod-to-dev.sh for the other direction." >&2
  exit 1
fi
case "$SRC_PORT/$DST_PORT" in
  *6543*) echo "WARNING: a URL uses port 6543 (transaction pooler); dump/restore needs 5432." >&2 ;;
esac

psql_src() { PGPASSWORD="$SRC_PASS" psql -h "$SRC_HOST" -p "$SRC_PORT" -U "$SRC_USER" -d "$SRC_DB" "$@"; }
psql_dst() { PGPASSWORD="$DST_PASS" psql -h "$DST_HOST" -p "$DST_PORT" -U "$DST_USER" -d "$DST_DB" "$@"; }

# --- Row-level comparison (used by --verify and by the post-run check) ---------
# Hashes only the columns the two databases have in COMMON, so a schema drift
# shows up as a column-set warning rather than as thousands of phantom diffs.
compare_sides() {
  local cols_src="$WORK_DIR/cols.src" cols_dst="$WORK_DIR/cols.dst"
  local q="select table_name||'.'||column_name from information_schema.columns where table_schema='public' order by 1;"
  psql_src -tAc "$q" > "$cols_src"
  psql_dst -tAc "$q" > "$cols_dst"

  local gen="$WORK_DIR/hash.sql" first=1
  : > "$gen"
  local t common
  for t in "${SYNC_TABLES[@]}"; do
    common=$(comm -12 \
      <(grep "^$t\." "$cols_src" | sed "s/^$t\.//" | sort) \
      <(grep "^$t\." "$cols_dst" | sed "s/^$t\.//" | sort) | tr '\n' ',' | sed 's/,$//')
    if [ -z "$common" ]; then
      echo "  WARNING: no common columns for '$t' — skipping in comparison" >&2
      continue
    fi
    [ $first -eq 1 ] && first=0 || echo "union all" >> "$gen"
    echo "select '$t' as t, id::text as i, md5(row($common)::text) as h from public.$t" >> "$gen"
  done
  echo "order by 1,2;" >> "$gen"

  psql_src -tAF'|' -f "$gen" > "$WORK_DIR/hash.src"
  psql_dst -tAF'|' -f "$gen" > "$WORK_DIR/hash.dst"

  local rc=0
  printf '\n%-26s %8s %8s %10s %10s %9s\n' TABLE DEV PROD DEV_ONLY PROD_ONLY CONFLICT
  for t in "${SYNC_TABLES[@]}"; do
    # Sort on the id FIELD only. Sorting whole "id|hash" lines would order ids
    # as 10 > 109 (because '|' sorts above any digit), and both comm and join
    # silently miscount when their input is not sorted on the key they compare.
    grep "^$t|" "$WORK_DIR/hash.src" | cut -d'|' -f2,3 | sort -t'|' -k1,1 > "$WORK_DIR/a"
    grep "^$t|" "$WORK_DIR/hash.dst" | cut -d'|' -f2,3 | sort -t'|' -k1,1 > "$WORK_DIR/b"
    local dn pn donly ponly conf flag
    dn=$(wc -l < "$WORK_DIR/a" | tr -d ' '); pn=$(wc -l < "$WORK_DIR/b" | tr -d ' ')
    donly=$(comm -23 <(cut -d'|' -f1 "$WORK_DIR/a") <(cut -d'|' -f1 "$WORK_DIR/b") | wc -l | tr -d ' ')
    ponly=$(comm -13 <(cut -d'|' -f1 "$WORK_DIR/a") <(cut -d'|' -f1 "$WORK_DIR/b") | wc -l | tr -d ' ')
    conf=$(join -t'|' -j1 "$WORK_DIR/a" "$WORK_DIR/b" | awk -F'|' '$2!=$3' | wc -l | tr -d ' ')
    flag=""
    [ "$donly" -gt 0 ] && { flag="$flag  <-- $donly not yet in prod"; rc=1; }
    [ "$conf"  -gt 0 ] && { flag="$flag  <-- CONFLICT"; rc=1; }
    printf '%-26s %8s %8s %10s %10s %9s%s\n' "$t" "$dn" "$pn" "$donly" "$ponly" "$conf" "$flag"
  done
  return $rc
}

if [ "$MODE" = "verify" ]; then
  echo ">> Comparing dev and prod row-by-row (no writes)..."
  if compare_sides; then
    echo; echo ">> IN SYNC: prod has every dev row, with identical contents."
  else
    echo; echo ">> OUT OF SYNC: see the flagged rows above." >&2; exit 1
  fi
  exit 0
fi

# --- 1. Dump the dev rows (READ-ONLY on dev) ----------------------------------
# --column-inserts names every column explicitly, so the load does not depend on
# the two databases having identical column ORDER; --on-conflict-do-nothing is
# what makes existing prod rows untouchable.
echo ">> Dumping dev data -> $SQL_FILE"
: > "$SQL_FILE"
for t in "${SYNC_TABLES[@]}"; do
  PGPASSWORD="$SRC_PASS" pg_dump -h "$SRC_HOST" -p "$SRC_PORT" -U "$SRC_USER" -d "$SRC_DB" \
    --data-only --column-inserts --on-conflict-do-nothing \
    --no-owner --no-privileges --table="public.$t" >> "$SQL_FILE"
done
printf '   %s statements across %s tables (%s)\n' \
  "$(grep -c '^INSERT INTO' "$SQL_FILE" || true)" "${#SYNC_TABLES[@]}" "$(du -h "$SQL_FILE" | cut -f1)"
echo "   skipped: ${SKIP_TABLES[*]}"

if [ "$MODE" = "dry-run" ]; then
  echo
  echo ">> DRY RUN — nothing was written to prod. Rows prod is currently missing:"
  compare_sides || true
  echo
  echo ">> SQL kept at: $SQL_FILE"
  exit 0
fi

# --- 2. Load into prod, all-or-nothing ----------------------------------------
echo ">> Loading into prod (single transaction, ON CONFLICT DO NOTHING)..."
psql_dst -v ON_ERROR_STOP=1 --single-transaction -q -f "$SQL_FILE"
echo "   load committed."

# --- 3. Fast-forward the sequences --------------------------------------------
# Rows arrive with explicit ids, which does not advance the owning sequence, so
# the next app INSERT would collide. Only ever bump UPWARDS: prod's sequences
# already sit ahead of max(id) on tables with deletion gaps, and regressing one
# would hand out ids that are already taken.
echo ">> Fast-forwarding id sequences..."
psql_dst -v ON_ERROR_STOP=1 -q <<'SQL'
DO $$
DECLARE r RECORD; seq TEXT; mx BIGINT; cur BIGINT;
BEGIN
  FOR r IN
    SELECT c.relname AS tbl
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
     ORDER BY c.relname
  LOOP
    seq := pg_get_serial_sequence('public.' || quote_ident(r.tbl), 'id');
    CONTINUE WHEN seq IS NULL;
    EXECUTE format('SELECT COALESCE(MAX(id), 0) FROM public.%I', r.tbl) INTO mx;
    EXECUTE format('SELECT last_value FROM %s', seq) INTO cur;
    IF mx > cur THEN
      PERFORM setval(seq, mx, true);
      RAISE NOTICE 'sequence % : % -> %', seq, cur, mx;
    END IF;
  END LOOP;
END $$;
SQL

# --- 4. Verify ----------------------------------------------------------------
echo ">> Verifying..."
if compare_sides; then
  echo; echo ">> DONE — prod now has every dev row, with identical contents."
else
  echo; echo ">> DONE WITH DIFFERENCES — review the flagged rows above." >&2; exit 1
fi
