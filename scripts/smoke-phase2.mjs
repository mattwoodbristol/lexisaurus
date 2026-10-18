// End-to-end check of Phase 2 against `npm run dev` on :8787. Calls the real Claude API:
// one tutor opening (Haiku), one exercise batch (Haiku), and optionally one lesson (Sonnet).
// Usage: node scripts/smoke-phase2.mjs [--generate]
const BASE = process.env.BASE ?? 'http://localhost:8787';
const PASS = process.env.PASS ?? 'local-dev-pass';
const generate = process.argv.includes('--generate');
let cookie = '';
let failures = 0;

async function api(path, init = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'content-type': 'application/json', cookie, ...(init.headers ?? {}) },
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}
const han = (tokens) => (tokens ?? []).filter((t) => t.status);

await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ passphrase: PASS }) });

// Topics
const s1 = await api('/api/topics/suggest?lang=zh');
check('topic suggested', s1.status === 200 && s1.body.topic?.id > 0, s1.body.topic?.name);
const s2 = await api(`/api/topics/suggest?lang=zh&exclude=${s1.body.topic.id}`);
check('skip gives a different topic', s2.body.topic && s2.body.topic.id !== s1.body.topic.id, s2.body.topic?.name);
const all = await api('/api/topics?lang=zh');
check('about 40 topics seeded', all.body.topics?.length >= 38, String(all.body.topics?.length));

// Topic-led conversation, tutor opens
const conv = await api('/api/chat/conversations', { method: 'POST', body: JSON.stringify({ lang: 'zh', topicId: s2.body.topic.id }) });
check('conversation created with topic', conv.status === 201);
const open = await api(`/api/chat/conversations/${conv.body.id}/start`, { method: 'POST' });
check('tutor opens the conversation', open.status === 200 && !!open.body.assistant?.text, open.body.assistant?.text ?? JSON.stringify(open.body));
check('opening is annotated', han(open.body.assistant?.tokens).length > 0 && han(open.body.assistant.tokens).every((t) => t.pinyin));
const again = await api(`/api/chat/conversations/${conv.body.id}/start`, { method: 'POST' });
check('cannot open twice', again.status === 409);
const reply = await api(`/api/chat/conversations/${conv.body.id}/messages`, { method: 'POST', body: JSON.stringify({ text: '好的，我们聊吧。' }) });
check('reply after tutor opening', reply.status === 200 && !!reply.body.assistant?.text, reply.body.assistant?.text ?? JSON.stringify(reply.body));
const after = await api('/api/topics/suggest?lang=zh');
check('used topic is not suggested again', after.body.topic?.id !== s2.body.topic.id);
const list = await api('/api/chat/conversations?lang=zh');
check('conversation list shows topic', list.body.conversations?.[0]?.topic === s2.body.topic.name);

// Lessons
const lessons = await api('/api/lessons?lang=zh');
check('20 course lessons listed', lessons.body.lessons?.filter((l) => l.source === 'course_import').length === 20);
check('next lesson is the first incomplete', !!lessons.body.nextLesson, lessons.body.nextLesson?.title);
check('next to generate is lesson 21+', lessons.body.nextToGenerate?.courseNo >= 21, lessons.body.nextToGenerate?.title);
const l1 = lessons.body.lessons.find((l) => l.course_no === 1);
const page = await api(`/api/lessons/${l1.id}`);
check('lesson page has content and annotations', page.body.lesson?.content?.drills?.length > 0 && Object.keys(page.body.annotations ?? {}).length > 0);
const firstDrill = page.body.lesson.content.drills[0].zh;
check('drill Chinese is annotated with statuses', han(page.body.annotations[firstDrill]).length > 0, firstDrill);
const search = await api(`/api/lessons?lang=zh&q=${encodeURIComponent('是坐火车')}`);
check('Chinese search (trigram) finds lesson 11', search.body.lessons?.some((l) => l.course_no === 11), `${search.body.lessons?.length} hits`);
const short = await api(`/api/lessons?lang=zh&q=${encodeURIComponent('把')}`);
check('one-character search (LIKE) finds 把 lesson', short.body.lessons?.some((l) => l.course_no === 6), `${short.body.lessons?.length} hits`);
const done = await api(`/api/lessons/${l1.id}/done`, { method: 'POST' });
check('mark lesson 1 done creates a grammar card', done.body.grammarCards === 1, JSON.stringify(done.body).slice(0, 120));
const mistakes = await api('/api/lessons/mistakes?lang=zh');
check('mistakes listed', mistakes.body.mistakes?.length >= 50, String(mistakes.body.mistakes?.length));

// Review
const sum1 = await api('/api/review/summary?lang=zh');
check('review summary', typeof sum1.body.due === 'number', JSON.stringify(sum1.body));
const next = await api('/api/review/next?lang=zh&limit=6');
check('due items returned', next.body.items?.length > 0, `${next.body.items?.length} items; notice: ${next.body.notice}`);
const kinds = (next.body.items ?? []).map((i) => i.exercise.kind);
console.log('      kinds:', kinds.join(', '));
const withSentence = (next.body.items ?? []).filter((i) => i.exercise.kind !== 'flash');
check('generated sentences used for word cards', withSentence.length > 0);
for (const i of (next.body.items ?? []).slice(0, 3)) {
  const e = i.exercise;
  console.log(`      [${i.itemType} ${i.word?.lemma ?? i.grammar?.title}] ${e.kind}: ${e.clozeZh ?? e.promptZh ?? e.promptEn ?? '(flash)'} -> ${e.answerZh ?? e.answerEn ?? ''}`);
}
const first = next.body.items[0];
const ans = await api(`/api/review/${first.cardId}`, { method: 'POST', body: JSON.stringify({ rating: 3, kind: first.exercise.kind, exerciseId: first.exercise.sentenceId }) });
check('answer recorded and rescheduled', ans.status === 200 && new Date(ans.body.due) > new Date(), JSON.stringify(ans.body));
const bad = await api(`/api/review/${first.cardId}`, { method: 'POST', body: JSON.stringify({ rating: 7 }) });
check('invalid rating rejected', bad.status === 400);
const next2 = await api(`/api/review/next?lang=zh&limit=6`);
check('reviewed card no longer due', !next2.body.items?.some((i) => i.cardId === first.cardId));

if (generate) {
  const t0 = Date.now();
  const gen = await api('/api/lessons/generate', { method: 'POST', body: JSON.stringify({ lang: 'zh' }) });
  check('lesson generated', gen.status === 201, `${gen.body.title ?? JSON.stringify(gen.body)} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (gen.status === 201) {
    const g = await api(`/api/lessons/${gen.body.id}`);
    const c = g.body.lesson.content;
    check('generated lesson is complete', c.drills.length >= 3 && c.examples.length >= 2 && c.errors.length > 0, `${c.examples.length} examples, ${c.drills.length} drills, ${c.errors.length} errors`);
    check('no pinyin in generated Chinese', ![...c.examples, ...c.drills].some((x) => /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/.test(x.zh)));
    console.log('      pattern:', c.pattern);
    console.log('      drill 1:', c.drills[0].en, '->', c.drills[0].zh);
  }
}

const usage = await api('/api/chat/usage');
console.log('usage today:', JSON.stringify(usage.body.usage));
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
