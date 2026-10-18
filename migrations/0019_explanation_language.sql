-- Explanations in the language being learnt (setting <lang>.explain_in).
-- lessons.explain_lang: the language a lesson's explanations are written in (NULL = English, as
-- all lessons before this were).
ALTER TABLE lessons ADD COLUMN explain_lang TEXT;
-- A lesson's explanatory text in another language, written once and kept until the lesson changes.
CREATE TABLE lesson_texts (
  lesson_id   INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  lang        TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  parts_json  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (lesson_id, lang)
);
-- Short texts (hints, correction notes, marking feedback) translated for the translate button.
CREATE TABLE text_translations (
  text        TEXT NOT NULL,
  to_lang     TEXT NOT NULL,
  translation TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (text, to_lang)
);
