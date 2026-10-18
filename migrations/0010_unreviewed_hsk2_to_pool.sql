-- The Pleco import counted every HSK 1-2 word as known. 463 HSK 2 words (e.g. 检查) had never been
-- reviewed in Pleco or this app and were not known. Those without a card and never met in a chat
-- go back to the pool, where new-words-per-day introduces them (HSK 2 first).
UPDATE words SET status = 'new'
WHERE source = 'pleco_import' AND status = 'known'
  AND json_extract(meta_json, '$.pleco.reviewed') IS NULL
  AND json_extract(meta_json, '$.hsk') <= 2
  AND NOT EXISTS (SELECT 1 FROM srs_cards s WHERE s.item_type = 'word' AND s.item_id = words.id)
  AND NOT EXISTS (SELECT 1 FROM exposures e WHERE e.word_id = words.id);

-- "Don't know this" from the word sheet: the learner asked for the card, so it skips the daily
-- new-word ration and comes first.
ALTER TABLE srs_cards ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
