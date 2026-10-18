-- Phase 2: topics in use, course lessons, mistakes, cached exercises, review log.

ALTER TABLE lessons ADD COLUMN course_no INTEGER;                       -- position in the curriculum (1-20 imported, 21+ generated)
ALTER TABLE lessons ADD COLUMN source TEXT NOT NULL DEFAULT 'generated'; -- 'course_import' | 'generated'
ALTER TABLE lessons ADD COLUMN completed_at TEXT;                       -- set when the author marks the lesson done
CREATE UNIQUE INDEX lessons_lang_course_no ON lessons(lang, course_no) WHERE course_no IS NOT NULL;

ALTER TABLE grammar_points ADD COLUMN meta_json TEXT;
ALTER TABLE conversations ADD COLUMN custom_topic TEXT;                  -- "pick my own topic"

-- Personal mistakes worth reviewing (from lesson notes, the Italian corrections list, and chats).
CREATE TABLE mistakes (
  id               INTEGER PRIMARY KEY,
  lang             TEXT NOT NULL REFERENCES languages(id),
  grammar_point_id INTEGER REFERENCES grammar_points(id) ON DELETE SET NULL,
  wrong            TEXT NOT NULL,
  right            TEXT NOT NULL,
  note             TEXT,
  source           TEXT NOT NULL,                                       -- 'course_import' | 'conversation' | 'lesson'
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (lang, wrong, right)
);

-- Cached exercise sentences so reviews do not hit the API every time (SPEC 8.4).
CREATE TABLE exercises (
  id           INTEGER PRIMARY KEY,
  lang         TEXT NOT NULL REFERENCES languages(id),
  item_type    TEXT NOT NULL CHECK (item_type IN ('word','grammar_point')),
  item_id      INTEGER NOT NULL,
  zh           TEXT NOT NULL,
  en           TEXT NOT NULL,
  target       TEXT,                                                    -- word the sentence practises
  source       TEXT NOT NULL,                                           -- 'generated' | 'lesson'
  used_count   INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (item_type, item_id, zh)
);
CREATE INDEX exercises_item ON exercises(item_type, item_id);

CREATE TABLE reviews (
  id          INTEGER PRIMARY KEY,
  card_id     INTEGER NOT NULL REFERENCES srs_cards(id) ON DELETE CASCADE,
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
  kind        TEXT,
  exercise_id INTEGER,
  reviewed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX reviews_card ON reviews(card_id, reviewed_at);
CREATE INDEX reviews_day ON reviews(reviewed_at);

-- Rebuild lesson search with the trigram tokenizer: unicode61 treats a run of Hanzi as a single
-- token, so searching 比 would never match 他比我高. Short queries (<3 chars) fall back to LIKE.
DROP TRIGGER IF EXISTS lessons_ai;
DROP TRIGGER IF EXISTS lessons_ad;
DROP TRIGGER IF EXISTS lessons_au;
DROP TABLE IF EXISTS lessons_fts;
CREATE VIRTUAL TABLE lessons_fts USING fts5(title, content_md, content='lessons', content_rowid='id', tokenize='trigram');
CREATE TRIGGER lessons_ai AFTER INSERT ON lessons BEGIN
  INSERT INTO lessons_fts(rowid, title, content_md) VALUES (new.id, new.title, new.content_md);
END;
CREATE TRIGGER lessons_ad AFTER DELETE ON lessons BEGIN
  INSERT INTO lessons_fts(lessons_fts, rowid, title, content_md) VALUES ('delete', old.id, old.title, old.content_md);
END;
CREATE TRIGGER lessons_au AFTER UPDATE OF title, content_md ON lessons BEGIN
  INSERT INTO lessons_fts(lessons_fts, rowid, title, content_md) VALUES ('delete', old.id, old.title, old.content_md);
  INSERT INTO lessons_fts(rowid, title, content_md) VALUES (new.id, new.title, new.content_md);
END;
INSERT INTO lessons_fts(lessons_fts) VALUES ('rebuild');

INSERT OR IGNORE INTO settings(key, value) VALUES ('srs.graduate_days', '21'), ('review.batch_size', '15');
