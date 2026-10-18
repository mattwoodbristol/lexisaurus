-- Generated listening practice: a dialogue or story at the learner's level, and how it went.
CREATE TABLE listenings (
  id           INTEGER PRIMARY KEY,
  lang         TEXT NOT NULL REFERENCES languages(id),
  kind         TEXT NOT NULL,              -- 'dialogue' or 'story'
  title        TEXT NOT NULL,
  content_json TEXT NOT NULL,              -- ListeningContent
  known_share  REAL,                       -- share of its words known when written (0-1)
  score        INTEGER,                    -- questions right, once answered
  total        INTEGER,
  done_at      TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX listenings_lang ON listenings(lang, created_at);
