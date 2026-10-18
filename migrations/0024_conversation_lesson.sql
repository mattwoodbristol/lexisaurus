-- A chat started from a lesson's "Use it" step: reaching the day's chat turns ticks that step off.
ALTER TABLE conversations ADD COLUMN lesson_id INTEGER REFERENCES lessons(id) ON DELETE SET NULL;
