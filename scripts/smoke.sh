#!/usr/bin/env bash
# End-to-end smoke test against a running `wrangler dev --test-scheduled` on :8787.
# Usage: PASS=local-dev-pass bash scripts/smoke.sh
set -u
BASE=${BASE:-http://localhost:8787}
PASS=${PASS:-local-dev-pass}
JAR=$(mktemp)
fail=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "PASS  $1 -> $3"; else echo "FAIL  $1 -> expected $2, got $3"; fail=1; fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

# wait for server
curl -s --retry 40 --retry-connrefused --retry-delay 1 -o /dev/null "$BASE/api/health" || { echo "server not up"; exit 1; }

echo "health: $(curl -s $BASE/api/health)"
check "health 200"            200 "$(code $BASE/api/health)"
check "settings w/o cookie"   401 "$(code $BASE/api/settings)"
check "languages w/o cookie"  401 "$(code $BASE/api/languages)"
check "login bad json"        400 "$(code -X POST -H 'content-type: application/json' -d '{bad' $BASE/api/auth/login)"
check "login wrong pass"      401 "$(code -X POST -H 'content-type: application/json' -d '{"passphrase":"nope"}' $BASE/api/auth/login)"
check "login right pass"      200 "$(code -c $JAR -X POST -H 'content-type: application/json' -d "{\"passphrase\":\"$PASS\"}" $BASE/api/auth/login)"
check "me authenticated"      '{"authenticated":true}' "$(curl -s -b $JAR $BASE/api/auth/me)"
check "settings with cookie"  200 "$(code -b $JAR $BASE/api/settings)"
echo "settings: $(curl -s -b $JAR $BASE/api/settings)"
check "put setting"           200 "$(code -b $JAR -X PUT -H 'content-type: application/json' -d '{"value":"all"}' $BASE/api/settings/zh.pinyin_mode)"
check "put bad key"           400 "$(code -b $JAR -X PUT -H 'content-type: application/json' -d '{"value":1}' "$BASE/api/settings/Bad%20Key")"
check "setting persisted"     '"all"' "$(curl -s -b $JAR $BASE/api/settings | sed -n 's/.*"zh.pinyin_mode":\("[a-z]*"\).*/\1/p')"
check "languages with cookie" 200 "$(code -b $JAR $BASE/api/languages)"
echo "languages: $(curl -s -b $JAR $BASE/api/languages | cut -c1-200)..."
check "unknown api 404"       404 "$(code -b $JAR $BASE/api/nothing)"
check "shell /"               200 "$(code $BASE/)"
check "spa fallback"          200 "$(code $BASE/lessons/42)"
check "manifest"              200 "$(code $BASE/manifest.webmanifest)"
check "sw.js"                 200 "$(code $BASE/sw.js)"
check "icon"                  200 "$(code $BASE/icons/icon-192.png)"
check "cron endpoint"         200 "$(code "$BASE/__scheduled?cron=*/15+*+*+*+*")"
check "logout"                200 "$(code -b $JAR -c $JAR -X POST $BASE/api/auth/logout)"
check "settings after logout" 401 "$(code -b $JAR $BASE/api/settings)"
# tampered cookie
check "tampered cookie"       401 "$(code -H 'Cookie: lt_session=9999999999.AAAA' $BASE/api/settings)"
rm -f "$JAR"
[ $fail = 0 ] && echo "ALL PASSED" || { echo "SOME FAILED"; exit 1; }
