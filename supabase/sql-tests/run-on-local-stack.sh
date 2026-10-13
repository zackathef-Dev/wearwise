#!/usr/bin/env bash
# Runs every database test against the RUNNING local Supabase (`supabase start`): the
# plain-SQL RLS and security suites in this folder, on Supabase's real auth, storage and
# realtime schemas, then the pgTAP tests (`supabase test db`).
#
#   bash supabase/sql-tests/run-on-local-stack.sh        (from the repository root)
#
# The suites expect an EMPTY database (some checks count every row), so this RESETS THE
# LOCAL DATABASE: once without the demo seed before the tests, and once with it afterwards.
# Anything you created locally is lost. It never touches a hosted project.
# Needs: the Supabase CLI and Docker. No local psql: it runs psql inside the database container.
# (dblink_password=postgres is the local stack's development database password, shown by
# `supabase status` as part of DB_URL. It is not a secret and exists only on your machine.)
set -euo pipefail
cd "$(dirname "$0")/../.."
project=$(sed -n 's/^project_id = "\(.*\)"/\1/p' supabase/config.toml)
db="supabase_db_${project}"
if ! docker inspect "$db" >/dev/null 2>&1; then
  echo "Local Supabase isn't running (no container $db). Start it first: supabase start" >&2; exit 1
fi

supabase db reset --no-seed
docker exec "$db" rm -rf /tmp/wearwise-tests
docker cp supabase "$db":/tmp/wearwise-tests >/dev/null   # \ir includes resolve against these copies

db_ip=$(docker exec "$db" hostname -i | awk '{print $1}')   # dblink's password-authenticated path
fail=0
for t in supabase/sql-tests/*.local.sql; do
  name=$(basename "$t")
  if out=$(docker exec -w /tmp/wearwise-tests/sql-tests "$db" \
        psql -U postgres -d postgres -v ON_ERROR_STOP=1 -v dblink_host="$db_ip" -v dblink_password=postgres -q -X -o /dev/null -f "$name" 2>&1); then
    echo "pass  $name ($(grep -c 'ok - ' <<<"$out") checks)"
  else
    echo "FAIL  $name"; grep -v 'NOTICE:  ok - ' <<<"$out" | head -8; fail=1
  fi
done
docker exec "$db" rm -rf /tmp/wearwise-tests

supabase test db || fail=1
supabase db reset          # put the demo seed back
[ "$fail" = 0 ] && echo "all database tests passed" || { echo "some database tests FAILED" >&2; exit 1; }
