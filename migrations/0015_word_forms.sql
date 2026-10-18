-- Inflected forms for Latin-script languages (Italian): a form seen in text (parlava) maps to its
-- dictionary word (parlare). Learned once per form when the learner taps it, then reused for
-- annotation and status. Mandarin does not use this.
CREATE TABLE word_forms (
  lang       TEXT NOT NULL,
  form       TEXT NOT NULL,                 -- lower case, as in text
  lemma      TEXT NOT NULL,                 -- dictionary form, lower case
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (lang, form)
);
CREATE INDEX word_forms_lemma ON word_forms(lang, lemma);

-- The dictionary form behind a cached gloss (Latin-script languages; the key column 'lemma' holds
-- the form that was looked up).
ALTER TABLE gloss_cache ADD COLUMN base TEXT;

-- Languages switched on (home switcher, reminders). Italian is configured but off until enabled.
INSERT OR IGNORE INTO settings(key, value) VALUES ('languages.enabled', '["zh"]');
