-- Themed vocabulary packs: words, phrases and grammar around one theme, and the last quiz score.
CREATE TABLE themes (
  id           INTEGER PRIMARY KEY,
  lang         TEXT NOT NULL REFERENCES languages(id),
  title        TEXT NOT NULL,
  request      TEXT NOT NULL,              -- the theme as asked for (name and hint)
  content_json TEXT NOT NULL,              -- ThemeContent
  score        INTEGER,                    -- last quiz: right answers
  total        INTEGER,
  practised_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX themes_lang ON themes(lang, updated_at);
