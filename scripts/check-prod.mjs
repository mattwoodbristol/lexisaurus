// Production check that leaves no trace in the learning data: read-only calls plus one
// throwaway chat, which it deletes afterwards. Exercise sentences it generates stay cached
// (they are wanted anyway).
// Usage: BASE=https://… PASS=… node scripts/check-prod.mjs
const BASE = process.env.BASE;
const PASS = process.env.PASS;
if (!BASE || !PASS) throw new Error('set BASE and PASS');
let cookie = '';
let failures = 0;
async function api(path, init = {}) {
  const t0 = Date.now();
  const res = await fetch(BASE + path, { ...init, headers: { 'content-type': 'application/json', cookie, ...(init.headers ?? {}) } });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, ms: Date.now() - t0 };
}
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}

const h = await api('/api/health');
check('health', h.body.ok && h.body.claude === 'configured', JSON.stringify(h.body));
check('API locked without login', (await api('/api/settings')).status === 401);
check('wrong passphrase rejected', (await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ passphrase: 'nope' }) })).status === 401);
const login = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ passphrase: PASS }) });
check('login', login.status === 200);
const shell = await fetch(BASE + '/');
check('PWA shell served over HTTPS', shell.status === 200 && BASE.startsWith('https://'));
check('service worker', (await fetch(BASE + '/sw.js')).status === 200);
check('manifest', (await fetch(BASE + '/manifest.webmanifest')).status === 200);

const t = await api('/api/topics/suggest?lang=zh');
check('topic suggestion', !!t.body.topic, `${t.body.topic?.name} (${t.ms} ms)`);
const l = await api('/api/lessons?lang=zh');
check('20 lessons', l.body.lessons?.length >= 20, `${l.ms} ms`);
const page = await api(`/api/lessons/${l.body.lessons[10].id}`);
check('lesson page annotated', Object.keys(page.body.annotations ?? {}).length > 0, `${page.ms} ms`);
const s = await api('/api/review/summary?lang=zh');
check('review summary', typeof s.body.due === 'number', `due ${s.body.due}, today ${s.body.remaining_today}`);
const n = await api('/api/review/next?lang=zh&limit=5');
check('review items with sentences', n.body.items?.length > 0, `${n.body.items?.length} items, kinds ${n.body.items?.map((i) => i.exercise.kind).join('/')} (${n.ms} ms)`);

const sess = await api('/api/session/today?lang=zh');
check('daily session composed', typeof sess.body.reviews?.remaining === 'number' && 'grammar' in sess.body && !!sess.body.conversation, `${sess.body.reviews?.remaining} reviews, grammar ${sess.body.grammar?.title ?? 'none yet'}, topic ${sess.body.conversation?.topic?.name} (${sess.ms} ms)`);
const vk = await api('/api/push/vapid-key');
check('VAPID public key served', typeof vk.body.publicKey === 'string' && vk.body.publicKey.length > 80);
const ps = await api('/api/push/status');
check('push status', ps.body.configured === true, `${ps.body.subscriptions?.length} subscription(s)`);

// Throwaway chat (no topic, so topic history is untouched), then delete it.
const conv = await api('/api/chat/conversations', { method: 'POST', body: JSON.stringify({ lang: 'zh' }) });
const msg = await api(`/api/chat/conversations/${conv.body.id}/messages`, { method: 'POST', body: JSON.stringify({ text: '你好，今天天气怎么样？' }) });
check('chat reply from Claude', msg.status === 200 && !!msg.body.assistant?.text, `${msg.body.assistant?.text ?? JSON.stringify(msg.body)} (${msg.ms} ms)`);
console.log(`THROWAWAY_CONVERSATION=${conv.body.id}`);
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
