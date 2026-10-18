-- First-run wizard: an install that already has words has been set up already.
INSERT OR IGNORE INTO settings(key, value) SELECT 'setup.done', 'true' WHERE EXISTS (SELECT 1 FROM words);
