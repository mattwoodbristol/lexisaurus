-- Level check and word sorting.
-- words.level: difficulty band 1-6 (Mandarin HSK 1..6+, other languages CEFR A1..C2).
ALTER TABLE words ADD COLUMN level INTEGER;
-- When the learner sorted this word (know / don't know) in "Sort my words" or the level check.
ALTER TABLE words ADD COLUMN triaged_at TEXT;
CREATE INDEX words_lang_status_level ON words(lang, status, level);

-- Mandarin: the band from the imported HSK level (7-9 counts as the top band).
UPDATE words SET level = MIN(json_extract(meta_json, '$.hsk'), 6)
WHERE lang = 'zh' AND json_extract(meta_json, '$.hsk') IS NOT NULL;

-- Grammar questions for the level check, written once per language and band.
CREATE TABLE assessment_items (
  id         INTEGER PRIMARY KEY,
  lang       TEXT NOT NULL,
  band       INTEGER NOT NULL,
  item_json  TEXT NOT NULL,              -- {prompt, options, answer, topic}
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX assessment_items_lang ON assessment_items(lang, band);

-- One level check: its parts' results as they come in, and the summary at the end.
CREATE TABLE assessments (
  id          INTEGER PRIMARY KEY,
  lang        TEXT NOT NULL,
  vocab_json  TEXT,
  grammar_json TEXT,
  writing_json TEXT,
  result_json TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at TEXT
);
CREATE INDEX assessments_lang ON assessments(lang, created_at);
