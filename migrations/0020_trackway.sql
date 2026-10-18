-- Trackway: one footprint per local day the daily session was finished. Rows are written when
-- the session is computed as done; the streak is counted across languages.
CREATE TABLE study_days (
  day  TEXT NOT NULL,                -- YYYY-MM-DD in the learner's time zone
  lang TEXT NOT NULL,
  PRIMARY KEY (day, lang)
);

-- Backfill from existing activity so the trackway does not start from nothing: a day with both a
-- review and a chat turn stands in for a finished session (UTC days, close enough once).
INSERT OR IGNORE INTO study_days(day, lang)
SELECT r.day, r.lang FROM (
  SELECT DISTINCT substr(rv.reviewed_at, 1, 10) AS day, s.lang FROM reviews rv JOIN srs_cards s ON s.id = rv.card_id
) r
WHERE EXISTS (
  SELECT 1 FROM messages m JOIN conversations c ON c.id = m.conversation_id
  WHERE c.lang = r.lang AND m.role = 'user' AND substr(m.created_at, 1, 10) = r.day
);
