import { Hono } from 'hono';
import type { Env } from './env';
import { authRoutes, requireSession, passphraseIsSet } from './auth';
import { settingsRoutes } from './settings';
import { chatRoutes } from './chat';
import { topicRoutes } from './topics';
import { lessonRoutes } from './lessons';
import { prepareStory, reviewRoutes } from './review';
import { sessionRoutes } from './session';
import { pushRoutes } from './push';
import { lookupRoutes } from './lookup';
import { assessmentRoutes, topUpStarterPool } from './assessment';
import { textRoutes } from './texts';
import { courseRoutes } from './course';
import { listeningRoutes } from './listening';
import { pageQueryRoutes } from './page-query';
import { updateRoutes } from './updates';
import { runReminders } from './notify';
import { tagWordLevels } from './word-levels';
import { listLanguages, validateLanguageConfig } from '../core/languages';
import { MODELS } from '../core/models';
import { enabledLanguages } from './day';

const app = new Hono<{ Bindings: Env }>();

// Public
app.get('/api/health', async (c) => {
  let db = 'ok';
  try {
    await c.env.DB.prepare('SELECT 1').first();
  } catch (e) {
    db = `error: ${(e as Error).message}`;
  }
  return c.json({ ok: db === 'ok', app: c.env.APP_NAME, time: new Date().toISOString(), db, claude: c.env.ANTHROPIC_API_KEY ? 'configured' : 'missing', passphrase: passphraseIsSet(c.env.PASSPHRASE) ? 'set' : 'missing' });
});
app.route('/api/auth', authRoutes);

// Private: everything else under /api requires a session cookie.
app.use('/api/*', async (c, next) => {
  if (c.req.path.startsWith('/api/auth/') || c.req.path === '/api/health') return next();
  return requireSession(c, next);
});
app.route('/api/settings', settingsRoutes);
app.route('/api/chat', chatRoutes);
app.route('/api/topics', topicRoutes);
app.route('/api/lessons', lessonRoutes);
app.route('/api/review', reviewRoutes);
app.route('/api/session', sessionRoutes);
app.route('/api/push', pushRoutes);
app.route('/api/words', lookupRoutes);
app.route('/api/assessment', assessmentRoutes);
app.route('/api/text', textRoutes);
app.route('/api/course', courseRoutes);
app.route('/api/listening', listeningRoutes);
app.route('/api/query-page', pageQueryRoutes);
app.route('/api/updates', updateRoutes);
app.get('/api/languages', async (c) => {
  const enabled = new Set(await enabledLanguages(c.env.DB));
  const langs = listLanguages().map((l) => ({ ...l, enabled: enabled.has(l.id), problems: validateLanguageConfig(l) }));
  return c.json({ languages: langs, models: MODELS });
});

app.notFound((c) => c.json({ error: 'not found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal error' }, 500);
});

export default {
  fetch: app.fetch,
  // Cron (every 15 min): reminders are decided in code (times, quiet hours, session done).
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runReminders(env, new Date(event.scheduledTime))
        .then((log) => console.log(`[cron ${event.cron}]`, log.join(' | ') || 'nothing due'))
        .catch((e) => console.error('[cron] reminders failed', e)),
    );
    // The pool kept stocked at the learner's level, and the next review set's story written ahead
    // so the review opens without waiting for it.
    ctx.waitUntil(
      (async () => {
        for (const lang of await enabledLanguages(env.DB)) {
          // Words at the learner's level first, so the story below can use them.
          await topUpStarterPool(env, lang).catch((e) => console.error(`[cron] ${lang} starter pool failed`, e));
          const status = await prepareStory(env, lang).catch((e) => `failed: ${e}`);
          if (status === 'story written' || status.startsWith('failed')) console.log(`[cron ${event.cron}] ${lang} review story: ${status}`);
        }
      })(),
    );
    // Housekeeping: band unbanded words, a batch at a time.
    ctx.waitUntil(
      tagWordLevels(env)
        .then((line) => line && console.log(`[cron ${event.cron}]`, line))
        .catch((e) => console.error('[cron] word levels failed', e)),
    );
  },
} satisfies ExportedHandler<Env>;
