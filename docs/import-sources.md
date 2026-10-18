# Import sources (surveyed 2026-10-04)

## Mandarin: "Mandarin Lesson Vocabulary Dictionary" (Google Sheet)

A new copy is saved after each lesson (June to 9 Sep 2026, ~15 files, same title). Each
copy is a superset of the previous one, so import only the newest by `modifiedTime`.
Latest at survey time: id `1BYPT3b4x_P6u-hLWhoFqADifnMHLI8M8dTonpu56UII`, 70 entries.

Columns (row 1 is the header):

| Col | Header         | Notes |
|-----|----------------|-------|
| A   | Lesson         | `L2`..`L20`, or `useful`, or `personal` |
| B   | Character      | Hanzi; patterns use `...` placeholders, e.g. `对...来说`, `是关于...的` |
| C   | Pinyin         | tone-marked, may include apostrophes (`xīnshēng'ér`) |
| D   | English        | gloss |
| E   | Part of Speech | noun, verb, adjective, phrase, structure, proper noun, verb phrase, noun/verb, pronoun |
| F   | Notes          | free text; contrasts and usage rules |
| G   | (unnamed)      | overflow when a note contained a comma; append to F |

Import mapping to `words`:
- `lemma` = B with whitespace trimmed. Rows whose lemma contains `...` are **patterns**, not
  words: skip them for the pinyin annotator and store them as `grammar_points` instead.
- `reading` = C, `gloss` = D, `source` = `sheet_import`, `status` = `known`.
- Lesson tag, part of speech and notes go in a `meta_json` column (add in a Phase 1 migration).
- Proper nouns under `personal` are known words (never pinyin'd).

Note the Lesson numbers run to L20 while SPEC.md says the course is at Lesson 12; the two
numbering schemes differ (sheet = chat-lesson count, spec = textbook lesson). Clarify before
using lesson numbers for anything.

## Italian: three Anki-style sheets (20 Sep 2026)

| Sheet | Columns | Import as |
|---|---|---|
| `Italian_C1_C2_Collocation` (id `1qFcTIc-yHj4npQ3aLcuU31mEG6g4tb58hdBCnACn2cM`) | Front (English prompt + register), Back (Italian collocation), Example, Note | `words` (lemma = Back, gloss = Front) + example sentence cached for exercises |
| `Italian_C1_C2_Structural_Shift` (id `1Xvcpp9ZmoQWR_lr1jYZNHuFsiNsaF7vgxQ7-RGGuiKE`) | Front (instruction + source sentence), Back (target sentence), Grammar Rule | `grammar_points` (title from the rule, summary = Grammar Rule) |
| `Italian_C1_C2_Cloze` (id `1ZaDa5zc98zu-tShzG7obigKOTV8zzClG7Qq7gvYCOFk`) | Text (Anki cloze `{{c1::answer::hint}}`), English | fill-in-the-blank exercises; parse the cloze markup |

Only ~10 rows each; these are seed exercises, not a known-word list. Level is C1/C2, which
matches "advanced" in the spec.

## Pleco flashcard export (surveyed 2026-10-04)

File: `G:\My Drivelash-2610041548.xml` (7.5 MB, Pleco 2.0 Flashcard Exporter, Android,
`formatversion="2"`). Also in Drive as id `1ntlJoqRtmXCRcWNc-t8B-fcg4YKKAGgw`; too large for the
Drive connector, so read it from the mounted G: drive or copy it into `data/` (git-ignored).

Structure per card:

```xml
<card language="chinese">
  <entry>
    <headword charset="sc">国</headword><headword charset="tc">國</headword>
    <pron type="hypy" tones="numbers">guo2</pron>
    <defn>noun 1 country; nation; ...</defn>          <!-- missing on 185 cards -->
  </entry>
  <dictref dictid="PACE" entryid="22154752"/>
  <catassign category="HSK 3.0/Level 1"/>              <!-- 1,004 cards have 2+ categories -->
  <scoreinfo scorefile="Default" score="1908" difficulty="108" history="6666666"
             correct="7" incorrect="0" reviewed="7" sincelast="1"
             firstreviewedtime="1787002609" lastreviewedtime="1789820019"/>  <!-- only if reviewed -->
</card>
```

**Key finding: the deck is not a known-word list.** It is the full HSK 3.0 vocabulary plus two
personal categories, and only 1,922 of 11,958 cards have ever been reviewed (have `scoreinfo`).

| Category | Cards | With scores |
|---|---:|---:|
| HSK 3.0/Level 1 | 501 | 501 |
| HSK 3.0/Level 2 | 765 | 266 |
| HSK 3.0/Level 3 | 967 | 145 |
| HSK 3.0/Level 4 | 997 | 119 |
| HSK 3.0/Level 5 | 1069 | 101 |
| HSK 3.0/Level 6 | 1136 | 83 |
| HSK 3.0/Level 7-9 | 5619 | 196 |
| Duo Chars (personal) | 1245 | 1102 |
| Words (personal) | 724 | 173 |

Score distribution over the 1,922 scored cards (Pleco: new card = 100, grows with correct
answers): under 200: 247; 400-799: 164; 800-1599: 51; 1600-3199: 340; 3200+: 1117.
`history` is a string of per-review grades (6 = correct); `correct`/`incorrect`/`reviewed`
are counts; times are Unix seconds.

Import mapping (**confirmed by the author 2026-10-04**):
- `lemma` = simplified headword; `reading` = `pron` (tone numbers; convert to tone marks);
  `gloss` = first sense of `defn`, trimmed; `source` = `pleco_import`.
- `status`:
  - `known` if Pleco score > 1600, **or** the card is in HSK 3.0 Level 1 or Level 2;
  - otherwise `learning` if the card has been reviewed in Pleco (any score <= 1600). **Revised
    2026-10-05:** being in the personal categories `Duo Chars` or `Words` no longer makes a word
    `learning` by itself; about 470 of those had never been studied and flooded reviews.
    Migration 0009 moved them back to the pool;
  - otherwise `new`, tagged by HSK level so the vocab picker can draw from levels
    progressively as the author advances (current level HSK 2-3, so draw from Level 3 first).
- Seed FSRS state from Pleco `scoreinfo` (correct/incorrect/reviewed, last reviewed time)
  rather than starting cold.
- Store HSK level, categories and raw Pleco score fields in `meta_json`.
- Dedupe on simplified headword; keep the highest score when duplicates occur across categories.

## Still needed

- `Italiano_C1-C2.apkg` (Anki package on G: drive, 0.6 MB) may supersede the three Italian sheets; inspect in Phase 4.

## Mandarin course material (surveyed 2026-10-04)

Two Word documents from 2 June 2026, text-extracted into `data/course/` (git-ignored):

1. **`mandarin_lesson_plan.docx`** (Downloads; `mandarin_lesson_plan_1.docx` is a byte-identical
   copy). "Basic Course Lesson Plan": a level assessment from an earlier Pleco export (11,792
   cards, 1,399 reviewed, verdict HSK 2-3 / B1 entry, "vocabulary breadth exceeds active
   grammar control"), then 20 planned lessons, each with grammar focus, 4 drills, vocabulary to
   activate, and a chat prompt. Recurring errors to watch: 量词 precision, 把 overuse, 被 scope,
   得/地/的, time-place order.
2. **`mandarin-lessons-1-20.docx`** (OneDrive root). "Mandarin Coach: Grammar Lessons 1-20",
   the lessons actually taught. Each has Grammar Explanation (pattern, examples, key points),
   Translation Drills (English / Chinese / pinyin), and usually Common Errors (the author's real
   mistakes with corrections). **This is the sequence the vocabulary sheet's L-tags refer to**
   (sheet L19 = 对…来说, L20 = 除了…以外).

The two sequences agree for lessons 1-6 and then diverge:

| # | Plan (intended) | Notes (taught) |
|---|---|---|
| 1-6 | time/place order, 量词, 了, 比, 越来越, 把 | same |
| 7 | 得 complements | 被 passive |
| 8 | duration & frequency | 虽然…但是 |
| 9 | 离 / 从…到 | 如果…就 |
| 10 | 连…都/也 | 连…都/也 |
| 11 | 被 passive | 是…的 |
| 12 | resultative complements | 得 degree complements |
| 13 | 是…的 | 就算…也 |
| 14 | directional complements | 又…又 |
| 15 | 趋向补语 + 在/正在 review | 不管…都 |
| 16 | 如果/要是…就 | 让 |
| 17 | 因为…所以 | 再 vs 又 |
| 18 | 虽然…但是 | 先…然后…最后 |
| 19 | 不但…而且 / 不仅…还 | 对…来说 |
| 20 | review and error clinic | 除了…以外 |

Planned topics never taught (candidates for the next generated lessons): duration and
frequency, 离 for distance, resultative complements, directional complements, 因为…所以,
不但…而且 / 不仅…还, and a review/error clinic.

Import plan (Phase 2 "lessons" work, earlier than the spec's "later phase" since the material
is to hand): parse `mandarin-lessons-1-20.md` into 20 `lessons` rows (content_md + content_json
with explanation/examples/drills/errors), one `grammar_points` row per lesson, and seed the
drill sentences as cached exercises. The Common Errors are personal and high value: keep them
as "mistakes worth reviewing" tied to their grammar point.

Course position is moot: the author will redo the lessons (decided 2026-10-04). The 20 taught lessons are
the curriculum the app re-runs from Lesson 1; the untaught plan topics queue after them.

## Italian course material (surveyed 2026-10-04)

**`italiano_lezioni_e_progressi.docx`** (Downloads, "Aggiornato: ottobre 2026"; an older copy
sits in `OneDrive\Documents`). Text-extracted to `data/course/italiano_lezioni_e_progressi.md`.
Written in Italian. Five parts:

1. **Progress summary**: basic course 20/20 complete; advanced course 8/20 in progress; 30+ idioms.
2. **Basic course (20 lessons, all done)**: passato prossimo, imperfetto, their contrast, simple
   and articulated prepositions, direct/indirect pronouns, ne, ci, condizionale presente/passato,
   congiuntivo presente/passato, congiuntivo vs indicativo, futuro, trapassato, riflessivi,
   passive, modals, review. Titles only, no lesson bodies.
3. **Advanced course (20 lessons, 8 done)**: idioms (body, animals, food), colloquial
   expressions, house/kitchen/family vocabulary, talking with children (instructions and
   encouragement done; emotions, games pending), then slang, opinions, body/health, sport,
   time/frequency, emotions, colour idioms, storytelling, city/transport, review.
   **Confirms SPEC.md: "lessons 7-8 done: family vocabulary, talking with young children".**
   Next lesson = advanced 9 "Parlare con i bambini: emozioni e sentimenti".
4. **Idioms learned** (~55 rows, Italian / English): import as `words` with `status=learning`
   (they are actively being learned) and `source=sheet_import`-style course import.
5. **Corrections and key points** (~60 rows: wrong / right / note): the author's real recurring errors
   (prepositions with places, anche position, stare + gerundio, congiuntivo after sperare/volere,
   false friends like marmitta, barco, abbronzato). Import as review items tied to grammar points.
6. **Grammar rules to remember** (6 short rules): seed `grammar_points` for `it`.

Import plan: this document is the `it` seed. Unlike Mandarin there are no lesson bodies, so
basic-course lessons become grammar_points only (titles), and the advanced-course list becomes
the ordered topic/lesson queue the app continues from lesson 9.

The three `Italian_C1_C2_*` sheets and `Italiano_C1-C2.apkg` are separate C1/C2 drill material
(not from this course) and stay as exercise seeds.
