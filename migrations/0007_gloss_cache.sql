-- Tap-to-translate: Claude glosses for words that are not in the word list (lesson text, review
-- sentences). Words that are in the list keep their gloss in words.gloss instead.
CREATE TABLE gloss_cache (
  lang       TEXT NOT NULL,
  lemma      TEXT NOT NULL,
  gloss      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (lang, lemma)
);
