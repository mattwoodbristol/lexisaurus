import { Hono } from 'hono';
import type { Env } from './env';
import { authRoutes, requireSession, passphraseIsSet } from './auth';
import { settingsRoutes } from './settings';
import { chatRoutes } from './chat';
import { topicRoutes } from './topics';
import { lessonRoutes } from './lessons';
import { prepareSet, reviewRoutes } from './review';
import { sessionRoutes } from './session';
import { pushRoutes } from './push';
import { lookupRoutes } from './lookup';
import { assessmentRoutes, topUpStarterPool } from './assessment';
import { textRoutes } from './texts';
import { courseRoutes } from './course';
import { listeningRoutes } from './listening';
import { themeRoutes } from './themes';
import { pageQueryRoutes } from './page-query';
import { updateRoutes } from './updates';
import { runReminders } from './notify';
import { tagWordLevels } from './word-levels';
import { listLanguages, validateLanguageConfig } from '../core/languages';
import { MODELS } from '../core/models';
import { enabledLanguages, heldBack, holdBack } from './day';

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
app.route('/api/themes', themeRoutes);
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
    /** How long a background job that failed waits before the cron tries it again. */
    const IDLE_MS = 2 * 3600_000;
    ctx.waitUntil(
      runReminders(env, new Date(event.scheduledTime))
        .then((log) => console.log(`[cron ${event.cron}]`, log.join(' | ') || 'nothing due'))
        .catch((e) => console.error('[cron] reminders failed', e)),
    );
    // The pool kept stocked at the learner's level, and the next review set written ahead (its
    // story and the sentences it needs) so the review opens without waiting for them.
    ctx.waitUntil(
      (async () => {
        for (const lang of await enabledLanguages(env.DB)) {
          // Words at the learner's level first, so the story below can use them.
          await topUpStarterPool(env, lang).catch((e) => console.error(`[cron] ${lang} starter pool failed`, e));
          // A story that could not be written waits IDLE_MS before the cron tries again
          // (each try is a big call); the review screen still asks for one when it needs it.
          const idleKey = `${lang}.review_story_idle`;
          if (await heldBack(env.DB, idleKey, IDLE_MS)) continue;
          const { story, sentences } = await prepareSet(env, lang).catch((e) => ({ story: `failed: ${e}`, sentences: 0 }));
          await holdBack(env.DB, idleKey, story.startsWith('failed') || story.startsWith('no story'));
          if (story === 'story written' || story.startsWith('failed') || story.startsWith('no story') || sentences)
            console.log(`[cron ${event.cron}] ${lang} review set: ${story}${sentences ? `; sentences for ${sentences} words` : ''}`);
        }
      })(),
    );
    // Housekeeping: band unbanded words, a batch at a time.
    // A failed batch (it would be the same words again) waits like a failed story.
    ctx.waitUntil(
      (async () => {
        if (await heldBack(env.DB, 'word_levels.idle', IDLE_MS)) return;
        const line = await tagWordLevels(env).catch((e) => {
          console.error('[cron] word levels failed', e);
          return false as const;
        });
        await holdBack(env.DB, 'word_levels.idle', line === false);
        if (line) console.log(`[cron ${event.cron}]`, line);
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
