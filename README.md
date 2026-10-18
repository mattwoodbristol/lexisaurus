# Lexisaurus language tutor

A personal, single-user language tutor you run yourself: daily reviews with spaced repetition,
grammar lessons, and chat practice with a tutor that corrects you as much as you want. It runs on
your own Cloudflare account (free plan) and your own Claude API key, so your data stays yours.
Mandarin and Italian are built in; other languages need a config and a prompt set. See `SPEC.md`
for the full design.

- no ads
- no social media
- you're in control

## Run your own tutor

**No terminal needed:** click the button, sign in to Cloudflare (a free account is enough) and
enter a passphrase and your Anthropic API key (console.anthropic.com; set a monthly spend limit
there). Cloudflare copies this project to your GitHub account, creates the database and deploys
it. Step-by-step, with the iPhone and Android install: `docs/getting-started.md`.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/mattwoodbristol/lexisaurus)

**From a terminal** you need Node 22+ as well:

```sh
npm install
npx wrangler login      # once, opens the browser
npm run setup           # creates the database, deploys, stores your secrets
```

`npm run setup -- --dry-run` shows every step without changing anything. Setup asks for a
passphrase (how you sign in) and your API key and prints your app's address. The app generates
its own session and notification keys on first use. Open the address on your phone, add it to
your Home Screen (iPhone: Share, then "Add to Home Screen") and open it from there. A short
welcome asks which languages you want and a little about you, then a level check sets where
lessons and chat start.

**Updates.** With the button: your copy is not a fork, so it updates itself. Once a day a GitHub
Action (`.github/workflows/update.yml`) takes the latest published release and pushes it, and
Cloudflare rebuilds, applies any new database migrations and redeploys. From a terminal:
`git pull`, then `npm run deploy`.

**Your course.** Settings → Course (or the link on the Lessons page) lets Claude plan your next
lessons from your goals; each planned lesson is written when you reach it. The same page
downloads the course as a zip of plain files and uploads changed files (a whole zip or single
lessons), so you can edit it by hand or with Claude on claude.ai: the zip carries a guide
Claude follows (`docs/editing-with-claude.md`). Uploads are checked and previewed before
anything is saved, and progress is kept. From a terminal the same files are a course pack:
see `docs/course-packs.md` and the `course-author` skill in `.claude/skills/`.

**Costs.** Chat replies use Haiku; lessons and checking your chat messages use Sonnet. A daily
token budget (Settings) caps spending. Typical daily use costs a few pence.

**Backups.** Settings → Back up downloads all your data as one file. Cloudflare D1 also keeps
30 days of history (Time Travel) that can restore the database to an earlier point.

**Core principle:** code enforces the rules (pinyin annotation, topic rotation, SRS
scheduling, budgets); Claude supplies the language content.

## Layout

```
migrations/        D1 SQL migrations (applied with wrangler)
prompts/           versioned prompt files (Phase 1+)
scripts/           one-off Node scripts (icons, VAPID keys)
src/core/          framework-agnostic domain logic (auth, language config, models)
src/worker/        Cloudflare Worker (Hono): API routes, cron handler
src/web/           Vite + Preact PWA (shell, service worker, manifest)
test/              vitest unit tests for core logic
```

## Prerequisites

- Node 22+ (24 recommended), npm 10+
- A Cloudflare account (free plan is enough) and `npx wrangler login`

## Local setup

```sh
npm install
cp .dev.vars.example .dev.vars        # then set PASSPHRASE and ANTHROPIC_API_KEY
npm run db:migrate:local               # creates the local D1 database
npm run build                          # builds the PWA into dist/web
npm run dev                            # wrangler dev on http://localhost:8787
```

For fast frontend iteration run `npm run dev:web` in a second terminal (Vite on :5173,
proxies `/api` to wrangler on :8787).

Checks:

```sh
npm test          # unit tests (pinyin pipeline, importers, auth, SRS seeding)
npm run typecheck # worker/core and web projects
npm run smoke     # end-to-end against a running `npm run dev` (the chat part calls the real API)
```

If `GET /api/health` says `"claude":"missing"` although `.dev.vars` has the key, an older
`wrangler dev` is probably still alive on the port (stopping the wrapper leaves `workerd.exe`
running). Kill stray `workerd` and wrangler `node` processes and start again.

## Importing your word list (Phase 1)

```sh
npm run import:pleco -- path/to/pleco-export.xml   # Pleco XML -> data/seed/pleco-*.sql
npm run import:sheet                                          # vocabulary sheet CSV -> data/seed/sheet.sql
npm run seed:local                                            # apply all seed SQL to the local D1
```

Status rules on import (see `docs/import-sources.md`): known if Pleco score > 1600 or HSK level 1-2;
learning if in the personal Duo Chars / Words categories or ever reviewed; otherwise new, tagged by
HSK level. FSRS cards are seeded from Pleco review history. Re-running the import is safe: it never
downgrades a word the app has promoted to known.

Words the tutor uses that are not in the list are added as `learning` with an SRS card; words in the
pool with status `new` are promoted to `learning` the first time they appear in conversation.

## Phase 2: topics, lessons, reviews

```sh
npm run import:lessons    # data/course/mandarin-lessons-1-20.md -> data/seed/lessons.sql
npm run seed:local        # applies pleco, sheet and lessons seeds
node scripts/smoke-phase2.mjs [--generate]   # end-to-end, real API (--generate also writes one lesson, ~2p)
```

- **Topics**: ~40 seed topics per language in `src/core/languages/<id>.topics.ts`, inserted when a
  language has none. After that a course pack's `topics.json` owns them. `src/core/topics/select.ts` picks least-recently-used (age squared), averages a tag penalty
  over the last 5 sessions, adds ±20% jitter, and never repeats within the last 8 sessions. The
  tutor is told the topic and not to steer away from it; it opens the conversation itself.
- **Lessons**: one format for imported and generated lessons (`src/core/lessons/types.ts`). The 20
  taught lessons are imported from the notes; "Generate" writes the next planned lesson (the
  course pack's plan, or `<id>.curriculum.ts` before a pack is synced) with Sonnet using structured output, validation and one retry. Marking a
  lesson done puts its grammar points into SRS and starts tracking its words. Search uses an FTS5
  trigram index (3+ characters) with a LIKE fallback for 1-2 character Chinese queries.
- **Reviews**: FSRS via ts-fsrs. Exercises rotate cloze / Chinese-to-English / English-to-Chinese
  from cached sentences; missing sentences are generated in one Haiku batch and cached. A word
  becomes known when stability reaches `srs.graduate_days` (21) and drops back to learning on Pass. Unseen word cards are introduced at
  `review.new_per_day` (10) a day, HSK level first, shown with their meaning the first time.
  `review.daily_limit` (60) works through the backlog left by the Pleco import a slice a day.

## Course packs: editing the course

The course (lesson order, lesson content, planned lessons, topics) can be edited as plain files
and synced into the app without losing progress. In the app: Settings → Course
(`src/web/course.tsx`, `src/worker/course.ts`; zips via `src/core/course/zip.ts`). From a terminal: See `docs/course-packs.md`; the
`course-author` Claude Code skill (`.claude/skills/`) writes lessons in the right format.

```sh
npm run course -- export data/courses/zh --remote             # once: the live course as files
npm run course -- check  data/courses/zh
npm run course -- sync   data/courses/zh --remote --dry-run   # review, then without --dry-run
```

This replaces `import:lessons` for changes after the first import.

## Corrections in chat

Each message you write in chat is checked by a separate Sonnet call that runs alongside the
tutor's reply (`src/core/chat/corrections.ts`). Mistakes are rated: changes the meaning, the
grammar being practised or a recurring mistake, or minor. Settings → Corrections decides what
appears under your message: Light (meaning only), Balanced (the most important one, minor ones
not on every message) or Strict (up to three). Practice chats from a lesson are always Strict.
Tap ✓ to finish a chat: the summary lists every mistake, the grammar you used and new words, and
the mistakes join your mistakes list so lessons and later chats can target them.

## Tap to translate

Every Chinese word in chat, lessons and revealed review answers opens a sheet with pinyin,
meaning, a character breakdown and its status. Meanings come from the word list; when it has
none, Haiku writes a short gloss once and it is stored (`words.gloss` or `gloss_cache`).

## Phase 3: daily session and reminders

- **Daily session** (`/api/session/today`, home checklist): reviews up to the daily cap, one grammar
  point of the day (pulled forward if none is due), and a conversation of at least
  `session.min_chat_turns` user turns. "Today" is the learner's local day (`tz`, default Europe/London).
- **Reminders**: the cron runs every 15 minutes; `src/core/notify/schedule.ts` sends a slot from
  `zh.notify_times` once it is reached (catch-up window 2 h), never twice a day, never in
  `notify.quiet`, and not at all once the session is done. The text lists only what is left.
  Today's suggested topic is seeded by the date, so the reminder and the home page agree.
- **Push**: VAPID-signed, payload-less Web Push (`src/core/push/vapid.ts`, WebCrypto only). The
  service worker fetches `/api/push/latest` for the text, so no payload encryption is needed.
  The VAPID keys are generated on first use (`src/worker/keys.ts`). Settings has "Turn on
  notifications" and "Send a test". On iPhone and iPad, push needs iOS 16.4+ and the app opened
  from the Home Screen; the app shows how to add it there (`src/web/install.tsx`).
- Test locally: `npx wrangler dev --test-scheduled`, then `curl "http://localhost:8787/__scheduled?cron=*/15+*+*+*+*"`.
- Production check (leaves no trace): `BASE=https://… PASS=… node scripts/check-prod.mjs`.

## Pinyin rule

`src/core/pinyin/` is the deterministic pipeline the project exists for: segment with the learner's
own word list first (longest match, down to one character) and ICU second, attach pinyin from the
stored reading or from pinyin-pro in sentence context, then decide per word: Off never, All always,
Smart only when the word is not `known`. Claude is told to write Hanzi only and `stripPinyin`
removes anything that slips through. Fixture tests live in `test/pinyin.test.ts`.

## Environment variables and secrets

| Name | Where | Purpose |
|---|---|---|
| `PASSPHRASE` | secret | The single login passphrase (12+ characters) |
| `ANTHROPIC_API_KEY` | secret | Claude API key (server-side only) |
| `SESSION_SECRET` | optional secret | HMAC key for the session cookie. Generated and kept in D1 (`app_keys`) if unset |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | optional secret | Web Push keys. Generated and kept in D1 if unset (`npm run vapid` makes a pair by hand) |
| `VAPID_SUBJECT` | optional secret | Push contact; defaults to the app's own address, remembered when a device subscribes |
| `APP_NAME` | `wrangler.jsonc` vars | Display name |

A secret set on the Worker always wins over a generated key, so older installs that set them by
hand keep working. Locally these live in `.dev.vars` (git-ignored; start from `.dev.vars.example`).
In production: `npx wrangler secret put PASSPHRASE`, or the Cloudflare dashboard (Worker →
Settings → Variables and Secrets).

Never commit secrets. Set a hard monthly spend limit in the Anthropic Console as a backstop.

## Deploy

`npm run setup` (or the Deploy button) does the first deploy. After that `npm run deploy` builds,
applies new migrations to the remote D1 and deploys; Workers Builds runs the same script on each
push to a copy made with the button.

### Publishing a release

The public repository is made from this one by `scripts/make-public-copy.mjs`: tracked files
only, no git history, personal scripts and Cloudflare ids left out, and `release.json` stamped
with the release name (the date) and the public repository. Copies made with the button update
themselves from its `release` branch, so what you push there reaches everyone within a day:

```sh
node scripts/make-public-copy.mjs ../lexisaurus-public --repo <owner>/<repo>
# review, then in ../lexisaurus-public: commit, push main, and push main:release
```

The first time, the target is an empty folder; after that, your clone of the public repository
(its history and LICENSE are kept). Database migrations run on every copy as it updates, so they
must work on data already there. The update script keeps each copy's Worker name and database
id from its own `wrangler.jsonc` and its own workflow files; everything else is replaced. In this
repository `release.json` has no upstream, so the update workflow does nothing here. The home
screen says when a copy has fallen behind (`/api/updates`).

### Deploying on push

To deploy on every push to `main` from a Worker deployed by hand, connect the repository in the
Cloudflare dashboard (the Worker → Settings → Builds) with branch `main`, build command left
empty and deploy command `npm run deploy` (it builds the PWA and applies migrations; plain
`npx wrangler deploy` would skip both). The Worker's name must match `name` in
`wrangler.jsonc`. The version at the foot of every screen shows the build date and commit.

The Worker serves the built PWA as static assets with SPA fallback and runs first only for
`/api/*`. A cron trigger fires every 15 minutes; the code decides whether anything is due.

## Auth model

Single passphrase, compared in constant time, exchanged for an `HttpOnly; Secure; SameSite=Lax`
cookie carrying an HMAC-SHA256 signed expiry (30 days). All `/api/*` routes except
`/api/health` and `/api/auth/*` require it. The HTML shell itself is public (it contains no
data); put Cloudflare Access in front if you also want the shell gated.

## Adding a language

1. Add `src/core/languages/<id>.ts` exporting a `LanguageConfig`. Its `script` (`han` or `latin`)
   decides word splitting, answer comparison and tap-to-translate (`src/core/text/rules.ts`);
   `markUnknownWords` and `autoAddUnknownWords` suit a beginner list (Mandarin) or an advanced
   one (Italian). Register it in `src/core/languages/index.ts`.
2. Add its prompt set (`prompts/<id>.v1.ts`, registered in `prompts/languages.ts`): tutor,
   lesson, practice, exercises, grade, query and gloss.
3. Give it a course pack (`course.json` with its `lang`) and topics, then switch it on in
   Settings → Languages. Switched-off languages get no reminders.

Latin-script words are resolved to their dictionary form on first tap (parlava → parlare) with
Claude and remembered in `word_forms`, so inflected forms show the right status afterwards.

## Free-tier limits (checked 2026-10-04)

Workers Free: 100k requests/day, 10 ms CPU per request, 5 cron triggers per account, static
assets included. D1 Free: 5 GB storage, 5M rows read/day, 100k rows written/day. All
comfortably above a single user's needs. The 10 ms CPU limit is the one to watch; Claude
calls are I/O wait, not CPU.

## Support

Lexisaurus is free and made by one person. If it helps you, you can support it on
[Ko-fi](https://ko-fi.com/mattwoodbristol) (also linked from Settings in the app).

## Licence

GNU Affero General Public License v3.0 (AGPL-3.0): use, change and share it freely; if you share
a changed version, or run one for other people over the internet, make its source available
under the same licence. See `LICENSE`.
