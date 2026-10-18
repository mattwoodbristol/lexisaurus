#!/usr/bin/env bash
# End-to-end chat test against `wrangler dev` on :8787. Calls the real Claude API (small cost).
# Usage: PASS=local-dev-pass bash scripts/smoke-chat.sh
set -u
BASE=${BASE:-http://localhost:8787}; PASS=${PASS:-local-dev-pass}; JAR=$(mktemp)
curl -s --retry 40 --retry-connrefused --retry-delay 1 -o /dev/null "$BASE/api/health" || { echo "server not up"; exit 1; }
curl -s -c "$JAR" -X POST -H 'content-type: application/json' -d "{\"passphrase\":\"$PASS\"}" "$BASE/api/auth/login" >/dev/null
CID=$(curl -s -b "$JAR" -X POST -H 'content-type: application/json' -d '{"lang":"zh"}' "$BASE/api/chat/conversations" | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')
echo "conversation $CID"
# Body goes via a UTF-8 file: Chinese on the Windows command line gets mangled to '?'.
printf '%s' '{"text":"你好！我今天在家工作，下午想去图书馆。"}' > data/tmp/body.json
curl -s -b "$JAR" -X POST -H 'content-type: application/json; charset=utf-8' --data-binary @data/tmp/body.json "$BASE/api/chat/conversations/$CID/messages" > data/tmp/reply.json
node - <<'JS'
const r = JSON.parse(require("fs").readFileSync("data/tmp/reply.json","utf8"));
if (r.error) { console.log("ERROR", r); process.exit(1); }
const a = r.assistant; const toks = a.tokens || [];
const han = toks.filter(t => t.status);
const latin = (a.text.match(/[A-Za-z]{3,}/g) || []);
const toneMarks = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/.test(a.text);
console.log("reply:", a.text.replace(/\n/g," ⏎ "));
console.log("tokens:", toks.length, "han:", han.length, "statuses:", JSON.stringify(Object.fromEntries(["known","learning","new","unknown"].map(s=>[s,han.filter(t=>t.status===s).length]))));
console.log("every han token has pinyin:", han.every(t => t.pinyin && t.pinyin.length));
console.log("smart would show pinyin on:", han.filter(t => t.status !== "known").map(t => t.text+"("+t.pinyin+")").join(" "));
console.log("latin words in reply (should be none unless English grammar note):", latin.join(" ") || "none", "| tone marks in text:", toneMarks);
console.log("new words added:", JSON.stringify(r.newWords));
require("fs").writeFileSync("data/tmp/mid", String(a.id));
JS
MID=$(cat data/tmp/mid)
echo "translate: $(curl -s -b "$JAR" -X POST "$BASE/api/chat/conversations/$CID/messages/$MID/translate")"
echo "translate again (cached): $(curl -s -b "$JAR" -X POST "$BASE/api/chat/conversations/$CID/messages/$MID/translate" | cut -c1-80)"
echo "usage: $(curl -s -b "$JAR" "$BASE/api/chat/usage")"
echo "history msgs: $(curl -s -b "$JAR" "$BASE/api/chat/conversations/$CID" | node -pe 'JSON.parse(require("fs").readFileSync(0)).messages.length')"
echo "list: $(curl -s -b "$JAR" "$BASE/api/chat/conversations?lang=zh" | cut -c1-160)"
rm -f "$JAR"
