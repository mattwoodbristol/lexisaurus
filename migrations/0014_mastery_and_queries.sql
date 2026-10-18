-- Queried marks: the learner thinks an answer was marked wrongly. Sonnet re-checks; a wrong answer
-- key is kept here so the course file can be corrected (npm run course -- queries).
CREATE TABLE answer_queries (
  id            INTEGER PRIMARY KEY,
  lesson_id     INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
  place         TEXT NOT NULL,              -- e.g. 'check 3', 'produce 2', 'quiz'
  kind          TEXT NOT NULL,              -- choice | translate | fix | build
  task          TEXT NOT NULL,
  expected      TEXT NOT NULL,
  answer        TEXT NOT NULL,
  marked_right  INTEGER NOT NULL,
  learner_note  TEXT,
  learner_right INTEGER NOT NULL,           -- Sonnet's verdict on the learner's answer
  key_wrong     INTEGER NOT NULL,           -- the expected answer / answer key itself is wrong
  explanation   TEXT NOT NULL,
  better_key    TEXT,
  status        TEXT NOT NULL DEFAULT 'open', -- open | fixed (key corrected in the course)
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Spaced grammar quizzes (the grammar review card in Reviews): one row per quiz taken.
CREATE TABLE grammar_quizzes (
  id               INTEGER PRIMARY KEY,
  grammar_point_id INTEGER NOT NULL REFERENCES grammar_points(id) ON DELETE CASCADE,
  score            INTEGER NOT NULL,
  total            INTEGER NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX grammar_quizzes_point ON grammar_quizzes(grammar_point_id, created_at);

-- A studied grammar point used by the learner in chat, as judged by the tutor.
CREATE TABLE chat_uses (
  id               INTEGER PRIMARY KEY,
  grammar_point_id INTEGER NOT NULL REFERENCES grammar_points(id) ON DELETE CASCADE,
  message_id       INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  correct          INTEGER NOT NULL,
  prompted         INTEGER NOT NULL,        -- 1 if the tutor's previous message hinted at it
  quote            TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (grammar_point_id, message_id)
);
CREATE INDEX chat_uses_point ON chat_uses(grammar_point_id, created_at);
