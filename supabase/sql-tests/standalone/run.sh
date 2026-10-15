#!/bin/zsh
# Runs every migration plus the SQL tests against a throwaway local Postgres, with
# supabase-stub.sql standing in for Supabase's auth/storage schemas. No Docker.
#   PG_BIN=/path/to/postgres/bin supabase/sql-tests/standalone/run.sh
# PG_BIN defaults to the directory of the `pg_config` on your PATH. Any Postgres 15+ with
# the contrib extensions (pgcrypto, dblink) works, e.g. Homebrew `postgresql@17` or
# conda/micromamba `postgresql`. For the full Supabase stack in Docker, use
# `supabase test db` and docs/database.md instead.
set -euo pipefail
HERE=${0:A:h}; ROOT=${HERE:h:h:h}
PG_BIN=${PG_BIN:-$(pg_config --bindir 2>/dev/null || true)}
if [[ -z $PG_BIN || ! -x $PG_BIN/initdb ]]; then
  echo "No Postgres found: put its bin directory on PATH or set PG_BIN=/path/to/postgres/bin" >&2; exit 1
fi
DATA=$(mktemp -d); PORT=${PORT:-54329}
trap '"$PG_BIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DATA"' EXIT
"$PG_BIN/initdb" -D "$DATA" -U postgres -A trust >/dev/null
"$PG_BIN/pg_ctl" -D "$DATA" -o "-p $PORT -k $DATA -c listen_addresses=''" -l "$DATA/log" start >/dev/null
PSQL=("$PG_BIN/psql" -h "$DATA" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -f "$HERE/supabase-stub.sql"
for m in "$ROOT"/supabase/migrations/*.sql; do echo "migrate  ${m:t}"; "${PSQL[@]}" -f "$m"; done
for t in "$ROOT"/supabase/sql-tests/*.local.sql; do echo "test     ${t:t}"; "${PSQL[@]}" -o /dev/null -f "$t" 2>&1 | sed "s/^psql:.*NOTICE:  //"; done
echo "all passed"
