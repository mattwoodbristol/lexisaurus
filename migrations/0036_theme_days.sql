-- Themes run over several days: whether the learner follows one daily (shown on the home
-- screen), how many days are done and on which local date the last one was finished.
ALTER TABLE themes ADD COLUMN daily INTEGER NOT NULL DEFAULT 0;
ALTER TABLE themes ADD COLUMN days_done INTEGER NOT NULL DEFAULT 0;
ALTER TABLE themes ADD COLUMN last_done_date TEXT;
