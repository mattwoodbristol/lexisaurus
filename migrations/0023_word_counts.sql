-- Running totals of words per language and status, kept by triggers, so screens that show how
-- many words you know read one row instead of counting the word list. Triggers keep it right
-- whichever code path (or import script) changes a word.
CREATE TABLE word_counts (
  lang   TEXT NOT NULL,
  status TEXT NOT NULL,
  n      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (lang, status)
);
INSERT INTO word_counts(lang, status, n) SELECT lang, status, COUNT(*) FROM words GROUP BY lang, status;

CREATE TRIGGER word_counts_insert AFTER INSERT ON words BEGIN
  INSERT INTO word_counts(lang, status, n) VALUES (NEW.lang, NEW.status, 1)
    ON CONFLICT(lang, status) DO UPDATE SET n = n + 1;
END;

CREATE TRIGGER word_counts_delete AFTER DELETE ON words BEGIN
  UPDATE word_counts SET n = n - 1 WHERE lang = OLD.lang AND status = OLD.status;
END;

CREATE TRIGGER word_counts_update AFTER UPDATE OF lang, status ON words
WHEN OLD.lang IS NOT NEW.lang OR OLD.status IS NOT NEW.status BEGIN
  UPDATE word_counts SET n = n - 1 WHERE lang = OLD.lang AND status = OLD.status;
  INSERT INTO word_counts(lang, status, n) VALUES (NEW.lang, NEW.status, 1)
    ON CONFLICT(lang, status) DO UPDATE SET n = n + 1;
END;
