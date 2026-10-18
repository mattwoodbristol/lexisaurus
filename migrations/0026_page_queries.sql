-- "Query this page": the learner flags content that looks wrong on any screen; Sonnet checks it
-- and, on a lesson, may offer corrected sections the learner can apply.
CREATE TABLE IF NOT EXISTS page_queries (
  id            INTEGER PRIMARY KEY,
  lang          TEXT NOT NULL,
  screen        TEXT NOT NULL,              -- the route name, e.g. 'lesson', 'review'
  lesson_id     INTEGER REFERENCES lessons(id) ON DELETE SET NULL,
  note          TEXT NOT NULL,              -- what the learner thinks is wrong
  page_text     TEXT NOT NULL,              -- what was on screen
  content_wrong INTEGER NOT NULL,           -- Sonnet's verdict
  explanation   TEXT NOT NULL,
  fix_json      TEXT,                       -- replacement lesson sections, when offered
  status        TEXT NOT NULL DEFAULT 'open', -- open | applied
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
