-- Sectioned lessons: which steps the learner has finished, and every lesson-check attempt.
CREATE TABLE lesson_progress (
  lesson_id  INTEGER PRIMARY KEY REFERENCES lessons(id) ON DELETE CASCADE,
  steps_json TEXT NOT NULL DEFAULT '[]',   -- step keys done, e.g. ["learn","recognise"]
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE lesson_checks (
  id           INTEGER PRIMARY KEY,
  lesson_id    INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  score        INTEGER NOT NULL,           -- items right
  total        INTEGER NOT NULL,
  passed       INTEGER NOT NULL,           -- 1 if score/total >= pass mark at the time
  details_json TEXT NOT NULL,              -- per item: kind, right, answer
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX lesson_checks_lesson ON lesson_checks(lesson_id, created_at);

INSERT OR IGNORE INTO settings(key, value) VALUES ('lesson.pass_mark', '80');
