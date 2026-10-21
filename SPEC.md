# Language Tutor PWA: Starter Spec

A personal, single-user language tutor. A progressive web app (PWA) on Android with push notifications, backed by the Claude API. Mandarin first, Italian second, then Spanish and French.

**Core design principle:** code enforces the rules; Claude supplies the language content. Every recurring complaint with chat-based tutoring (forgetting the pinyin rule, repeating the same topic, losing track of what is due) is handled deterministically by the app, never by prompt instructions alone.

## 1. Goals

1. Grammar lessons saved as searchable pages that can be re-read later.
2. Vocabulary practice with spaced repetition.
3. Realistic conversation across a wide, rotating range of topics.
4. Regular reinforcement of grammar and vocabulary, scheduled by the app.
5. Chinese: pinyin toggle, off by default, automatically shown for words not yet known.
6. Voice practice (speech in and out), free tier first.
7. Languages are configuration, not code, so adding Spanish or French is a config file plus seed data.

## 2. Non-goals (v1)

- Multi-user support, accounts, or billing.
- Native app or app store distribution.
- Paid TTS/STT (design for swap-in, but start free).
- Handwriting or character-stroke practice.

## 3. Constraints

- **Cost:** minimum paid services. The Claude API is the only expected cost (target under about $5/month). Hosting should be on a free tier.
- **Platform:** Android, Chrome. Must work as an installed PWA with Web Push.
- **User is one person.** Simple auth is enough (see section 12).

## 4. Proposed stack

Claude Code may propose alternatives if there is a good reason, but should explain the trade-off first.

- **Hosting/runtime:** Cloudflare Workers, TypeScript, Hono framework.
- **Database:** Cloudflare D1 (SQLite), with FTS5 for lesson search.
- **Scheduling:** Cloudflare Cron Triggers.
- **Frontend:** Vite + Preact (or React) PWA, with a service worker for push and offline shell.
- **Push:** Web Push with VAPID keys.
- **LLM:** Anthropic API, called server-side only. Model IDs live in config. Verify current model IDs and pricing at https://platform.claude.com/docs before hardcoding. Default to Haiku for chat and exercises, and Sonnet for lesson generation.
- **Chinese processing:** `Intl.Segmenter('zh')` for word segmentation, `pinyin-pro` for pinyin.
- **SRS:** `ts-fsrs` (FSRS algorithm).
- **Voice (v1):** browser Web Speech API (`SpeechRecognition`, `speechSynthesis`) behind an interface so a paid provider can be swapped in later.

Fallback if serverless proves awkward: a small VPS running Node + SQLite. Keep the domain logic framework-agnostic so this is possible.

## 5. Language configuration

Each language is one config object plus seed data. Example shape:

```ts
interface LanguageConfig {
  id: 'zh' | 'it';            // later 'es', 'fr'
  name: string;
  speechRecognitionLang: string; // 'zh-CN', 'it-IT'
  ttsLang: string;
  hasRomanisation: boolean;      // true for zh only
  tutorStyle: string;            // prompt fragment
  userLevel: string;             // e.g. "HSK 2-3", "advanced"
  correctionStyle: 'inline-full-sentence' | 'end-of-turn' | 'none';
  conversationLanguageRule: string;
}
```

### Chinese (`zh`)
- Level: roughly HSK 2-3. The Pleco deck holds about 11,800 cards, so the known-word list is large.
- Tutor speaks Mandarin, except for grammar explanations, which are in English.
- Course position: through Lesson 12 of a structured course (covered 是…的 emphasis and potential complements). Lesson format is **grammar, then drills, then conversation**.
- Romanisation rules: see section 7.

### Italian (`it`)
- Level: advanced (course lessons 7-8 done: family vocabulary, talking with young children).
- Corrections: **inline, using the full corrected sentence**, not just the changed word.
- No romanisation.

## 6. Data model (D1)

Minimum tables; Claude Code may refine.

- `languages(id, config_json)`
- `words(id, lang, lemma, reading, gloss, source, status, created_at)`
  - `status`: `known` (imported), `learning`, `new`
  - `source`: `pleco_import`, `sheet_import`, `lesson`, `conversation`
- `srs_cards(id, item_type, item_id, lang, fsrs_state_json, due_at)`
  - `item_type`: `word` or `grammar_point`
- `grammar_points(id, lang, title, summary, lesson_id, created_at)`
- `lessons(id, lang, title, level, content_json, content_md, created_at)` plus an FTS5 index over `content_md`
- `topics(id, lang, name, tags, scenario_seed, last_used_at, use_count)`
- `conversations(id, lang, topic_id, started_at, ended_at)`
- `messages(id, conversation_id, role, text, created_at)`
- `exposures(word_id, conversation_id, seen_at)`, which feeds the "new word" logic
- `settings(key, value)`, including per-language pinyin mode and notification times
- `push_subscriptions(endpoint, keys_json)`
- `usage_log(date, model, input_tokens, output_tokens)` for the daily budget cap

## 7. Chinese pinyin rules (critical, deterministic)

Claude **never** produces pinyin in chat output. The server annotates after the fact. Instruct Claude to output Hanzi only, and strip any pinyin that slips through.

Pipeline for every Chinese message shown to the user:

1. Segment text into words with `Intl.Segmenter('zh', { granularity: 'word' })`.
2. Look up each word in `words`.
3. Annotate according to the active **pinyin mode**:
   - **Off:** no pinyin at all.
   - **Smart (default):** pinyin only for words whose status is `new` or `learning`, or that are not in the table at all. Words with status `known` get none.
   - **All:** pinyin on everything.
4. Render with `<ruby>` elements so pinyin sits above the characters.
5. A single-tap toggle in the UI cycles Off / Smart / All. The setting persists.

Word lifecycle:
- Imported known list (Pleco export, plus the supplementary vocabulary sheet) is `known`.
- Unrecognised words that appear in a lesson or conversation are added as `learning` and given an SRS card.
- When the SRS card graduates (configurable, e.g. stability above a threshold or N successful reviews), the status becomes `known` and pinyin stops appearing.

Shortcuts the user already uses (preserve them):
- Typing `p` shows full pinyin for the last tutor message.
- Typing `e` shows an English translation of the last tutor message.
- These are intercepted by the app and do not count as conversation turns.
- The same two actions are also available as small icon-style buttons on each tutor message, a single character each (e.g. 拼 and 英) rather than word labels, with aria-labels (added 2026-10-04). They work with the on-screen keyboard and voice input, not only by typing.

Note: the pinyin rule works at **word** level, not character level. Where a word is known but one of its characters is new elsewhere, it is still treated as known.

## 8. Features

### 8.1 Chat
- Free conversation scoped to a **topic and scenario** chosen by the app (section 8.2), not by Claude.
- Claude receives: language config, user level, topic, scenario seed, a few target words due for review, a grammar point to reinforce, and the last N messages.
- Chinese: respond in Mandarin, level-appropriate, Hanzi only.
- Italian: correct the user's mistakes inline with the full corrected sentence, then continue.
- End-of-session summary: new words encountered (added to `words` and SRS) and mistakes worth reviewing.

### 8.2 Topic rotation
- Seed ~40 topics per language (daily life, work, travel, health, food, hobbies, news, opinions, etc.). Claude Code can generate the seed list.
- Selection: least recently used, weighted by tags, with random jitter and a rule never to repeat a topic within the last K sessions.
- User can override with "pick my own topic" or skip a suggestion.
- Topic selection happens in code. Claude is told the topic, and is explicitly told not to steer to another one.

### 8.3 Grammar lessons
- Claude generates a lesson as structured JSON: title, level, explanation (English for Chinese), examples, short drills, and a list of grammar points.
- Lessons are stored and rendered as pages, with a browsable index (by language, level, date) and full-text search.
- Each grammar point gets an SRS card so it resurfaces automatically.
- Option to import existing course material later (not v1).

### 8.4 Vocabulary practice
- SRS review screen driven by `ts-fsrs`. Exercise types: translate to target language, translate to English, fill in the blank, listen and type (when voice is on).
- Claude generates exercise sentences in batches (cheap model), cached in the DB so reviews do not hit the API every time.
- Sentences should reuse the user's known vocabulary where possible, so the only unknown is the target word.
- New words within reach (2026-10-20): once a level check has measured the vocabulary band, reviews introduce new words only up to the next band above it (words met in chats and lessons excepted); harder words, including ones the check found unknown, wait in the pool. After the check's word part, a pool with fewer than 40 unsorted new words at the measured band and the next is filled with about 30 common everyday words per band (one Claude call); the 15-minute cron repeats the check, so the pool (and Sort my words) stays stocked and a cut-short fill is redone. The home screen offers sorting from 20 unsorted words. With fewer than 150 known words, sentence and story writers may also use common words at the learner's level instead of being held to the short list.
- Story reviews (2026-10-20, setting `review.story`, on by default): each set's sentence cards are written as one short connected story (same people and setting, beginning to end), shown in story order after any grammar card and before the matching board, with the story's title and part on each card, and the whole story (target words picked out, with English and audio) once the set's cards are done. Revised 2026-10-21: the stronger model writes the story, planning a premise first (a setting most words fit; a word that does not fit comes in through what someone says, sees or remembers); each card shows the sentence before it; the story is kept (setting `<lang>.review_story`, up to two days, so the next day's set can use it), so a reload or a fix carries on with it; since 2026-10-21 it is written ahead, by the 15-minute cron and when the home screen opens, and a review waits for one being written rather than writing a second, and a fix from "Something looks wrong?" is shown in place and must fit the story. Revised again 2026-10-21: the writer's word list puts words being learned (due or not) before known words, and a story may also use one word per sentence from up to 80 new words within reach of the learner's level ("learn soon"), which the checks allow; characters may have short common first names, listed by the writer so the checks do not count them as new words. Linking lines (2026-10-21): besides one tested line per word, a story may have linking lines that test nothing (at most two in a row, fewer than the tested lines), and target, known and soon words may come back in later lines; each card shows the lines since the previous card. One extra writer call and proofread per set; when there is no key or budget the set falls back to cached single sentences.

### 8.5 Reinforcement and notifications
- A daily "session" is composed by code: due vocab reviews, one grammar point review, and a conversation on the next topic.
- Cron sends a push notification at configured times (default: morning and evening, per language).
- Tapping the notification opens the relevant session directly.
- Respect quiet hours. Do not notify if the session is already done today.

### 8.6 Voice
- Mic button uses the browser `SpeechRecognition` API with the language's `speechRecognitionLang`.
- Tutor replies can be read aloud with `speechSynthesis`.
- Put both behind `SpeechProvider` / `TtsProvider` interfaces so paid providers can replace them without touching feature code.
- Known limitation: free Mandarin TTS tone quality varies. Collect feedback before paying for anything.
- Built (2026-10-14): `SpeechProvider` (`src/core/speech/provider.ts`) with the browser recogniser (`src/web/mic.tsx`). Mic in the chat composer and the lesson Produce/Fix steps fills the box for checking before sending. "Say it aloud" on Say-it review cards suggests the rating; "Repeat it" (shadowing) after zh→en, cloze and every model answer. The recogniser guesses the likeliest sentence, so this shows what it understood (characters or words marked, and for Chinese what it heard, with pinyin), not a pronunciation score.

### 8.7 Listening
- Generated, not sourced: Claude (`listening` model role) writes a dialogue (two speakers) or story at the measured level, using learning words, the grammar of the lesson worked on last and a random topic. Questions are multiple choice in the learner's own language, marked in code.
- Played sentence by sentence with `speechSynthesis`; two installed voices for a dialogue where available, otherwise a lower pitch for the second speaker. Any line can be replayed before the text is shown.
- After the questions: transcript with pinyin and tap-to-look-up, translations, and an optional mic under each line. The page shows the share of the passage's words already known (aim: 95-98%).
- Stored in `listenings`; not part of the daily session.

## 9. Claude API usage

- Server-side only; the API key is a Worker secret and never reaches the client.
- Prompts are assembled from: base tutor prompt, language config fragment, session context. Keep them in versioned files under `/prompts`.
- Use prompt caching for the stable system prompt.
- Use structured JSON output for lessons and exercises, with validation and a retry on parse failure.
- Daily token budget enforced in code via `usage_log`. When exceeded, degrade gracefully (reviews still work from cached exercises, chat shows a clear message).
- Set a hard monthly spend limit in the Anthropic Console as a backstop.

## 10. Import and export

- **Import:** Pleco deck export (text/CSV) into `words` as `known`; a CSV from the supplementary vocabulary Google Sheet as `known` or `learning`. Provide a CLI script or an admin page. Dedupe on lemma.
- **Export:** JSON/CSV export of words, lessons, SRS state and messages from an admin endpoint.
- **Backup (later phase):** scheduled export to Google Drive or Google Sheets. OAuth is fiddly, so keep this out of v1 and start with a manual download button.

## 11. UI outline

- **Home:** today's session (due reviews, grammar point, next topic), streak, quick language switch.
- **Chat:** messages with ruby pinyin rendering, mic button, pinyin mode toggle, `p` / `e` shortcuts, topic chip.
- **Review:** SRS card screen.
- **Lessons:** index, search, lesson page.
- **Words:** searchable list with status; manual status edit.
- **Settings:** per-language pinyin mode, notification times and quiet hours, daily token budget, import/export.
- Mobile-first, installable, usable one-handed.

## 12. Security and privacy

- Single-user. Protect everything behind Cloudflare Access or a single passphrase with a signed session cookie.
- Secrets (passphrase, Anthropic key) only in Worker secrets; the session and VAPID keys are generated by the Worker and kept in D1 (`app_keys`). Never in the repo.
- Learning data is personal but low sensitivity. No third-party analytics.

## 13. Build phases and acceptance criteria

**Phase 0: Skeleton**
- Repo, Worker, D1 migrations, PWA shell installable on Android, auth in place.

**Phase 1: Chinese chat with deterministic pinyin**
- Chat works end to end with Claude.
- Import the known-word list.
- Smart pinyin mode verified: known words show no pinyin, unknown words show pinyin, every time. Add unit tests for the annotation pipeline with fixture sentences.
- `p` and `e` shortcuts work. Toggle persists.

**Phase 2: Topics, lessons, vocab SRS**
- Topic rotation with no immediate repeats (test it).
- Lesson generation, storage, index and search.
- New words from conversations added automatically with SRS cards. Review screen works.

**Phase 3: Notifications and daily sessions**
- Cron composes the daily session and sends push. Deep link opens it. Quiet hours respected.

**Phase 4: Italian**
- Add `it` config and seed topics only. If this needs more than config plus seed data, the language abstraction is wrong; fix it.
- Inline full-sentence corrections verified.

**Phase 5: Voice**
- STT and TTS for both languages via the provider interfaces. Collect quality feedback.

**Phase 6: Polish**
- Backup to Drive/Sheets, usage dashboard, Spanish and French stubs.

## 14. Open questions for Claude Code to raise with the user

1. Cloudflare serverless, or a small VPS? (Check free-tier limits for D1 and Cron at build time.)
2. Exact export format from Pleco, and the column layout of the vocabulary Google Sheet.
3. Graduation threshold for moving a word from `learning` to `known`.
4. Default notification times and quiet hours.
5. Whether to import existing course lesson notes in a later phase.

## 15. Working agreements

- Work in small, reviewable steps; finish and test one phase before starting the next.
- Write tests for the pinyin annotation, topic rotation and SRS scheduling logic, since those are the rules the whole project exists to enforce.
- Keep a `README.md` with setup, env vars, deploy steps and how to add a language.
- Never log or commit secrets.
