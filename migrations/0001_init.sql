-- Phase 0 schema. All ids are INTEGER PRIMARY KEY (SQLite rowid) so that the
-- FTS5 external-content table can reference lessons by rowid.

CREATE TABLE languages (
  id          TEXT PRIMARY KEY,            -- 'zh', 'it', later 'es', 'fr'
  config_json TEXT NOT NULL
);

CREATE TABLE words (
  id         INTEGER PRIMARY KEY,
  lang       TEXT NOT NULL REFERENCES languages(id),
  lemma      TEXT NOT NULL,
  reading    TEXT,                          -- pinyin for zh; NULL otherwise
  gloss      TEXT,
  source     TEXT NOT NULL CHECK (source IN ('pleco_import','sheet_import','lesson','conversation','manual')),
  status     TEXT NOT NULL CHECK (status IN ('known','learning','new')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (lang, lemma)                      -- dedupe on lemma per language
);
CREATE INDEX words_lang_status ON words(lang, status);

CREATE TABLE lessons (
  id           INTEGER PRIMARY KEY,
  lang         TEXT NOT NULL REFERENCES languages(id),
  title        TEXT NOT NULL,
  level        TEXT,
  content_json TEXT NOT NULL,
  content_md   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX lessons_lang_created ON lessons(lang, created_at DESC);

-- Full-text search over lessons (external content table + sync triggers).
CREATE VIRTUAL TABLE lessons_fts USING fts5(
  title, content_md,
  content='lessons', content_rowid='id',
  tokenize='unicode61'
);
CREATE TRIGGER lessons_ai AFTER INSERT ON lessons BEGIN
  INSERT INTO lessons_fts(rowid, title, content_md) VALUES (new.id, new.title, new.content_md);
END;
CREATE TRIGGER lessons_ad AFTER DELETE ON lessons BEGIN
  INSERT INTO lessons_fts(lessons_fts, rowid, title, content_md) VALUES ('delete', old.id, old.title, old.content_md);
END;
CREATE TRIGGER lessons_au AFTER UPDATE ON lessons BEGIN
  INSERT INTO lessons_fts(lessons_fts, rowid, title, content_md) VALUES ('delete', old.id, old.title, old.content_md);
  INSERT INTO lessons_fts(rowid, title, content_md) VALUES (new.id, new.title, new.content_md);
END;

CREATE TABLE grammar_points (
  id         INTEGER PRIMARY KEY,
  lang       TEXT NOT NULL REFERENCES languages(id),
  title      TEXT NOT NULL,
  summary    TEXT,
  lesson_id  INTEGER REFERENCES lessons(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE srs_cards (
  id              INTEGER PRIMARY KEY,
  item_type       TEXT NOT NULL CHECK (item_type IN ('word','grammar_point')),
  item_id         INTEGER NOT NULL,
  lang            TEXT NOT NULL REFERENCES languages(id),
  fsrs_state_json TEXT NOT NULL,
  due_at          TEXT NOT NULL,
  UNIQUE (item_type, item_id)
);
CREATE INDEX srs_cards_due ON srs_cards(lang, due_at);

CREATE TABLE topics (
  id            INTEGER PRIMARY KEY,
  lang          TEXT NOT NULL REFERENCES languages(id),
  name          TEXT NOT NULL,
  tags          TEXT NOT NULL DEFAULT '',   -- comma-separated
  scenario_seed TEXT,
  last_used_at  TEXT,
  use_count     INTEGER NOT NULL DEFAULT 0,
  UNIQUE (lang, name)
);

CREATE TABLE conversations (
  id         INTEGER PRIMARY KEY,
  lang       TEXT NOT NULL REFERENCES languages(id),
  topic_id   INTEGER REFERENCES topics(id) ON DELETE SET NULL,
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ended_at   TEXT
);

CREATE TABLE messages (
  id              INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant')),
  text            TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX messages_conversation ON messages(conversation_id, id);

CREATE TABLE exposures (
  word_id         INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  seen_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (word_id, conversation_id)
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,                   -- e.g. 'zh.pinyin_mode', 'zh.notify_times'
  value TEXT NOT NULL                       -- JSON-encoded
);

CREATE TABLE push_subscriptions (
  endpoint   TEXT PRIMARY KEY,
  keys_json  TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE usage_log (
  date          TEXT NOT NULL,              -- 'YYYY-MM-DD' (UTC)
  model         TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, model)
);

INSERT INTO settings(key, value) VALUES
  ('zh.pinyin_mode', '"smart"'),
  ('daily_token_budget', '200000');
