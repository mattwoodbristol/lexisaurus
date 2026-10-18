-- New words per day: unseen word cards are rationed by the review.new_per_day setting.
ALTER TABLE srs_cards ADD COLUMN first_seen_at TEXT;   -- when an unseen card was first answered
CREATE INDEX srs_cards_first_seen ON srs_cards(lang, first_seen_at);

-- Cards already answered in the app have been seen.
UPDATE srs_cards SET first_seen_at = (SELECT MIN(r.reviewed_at) FROM reviews r WHERE r.card_id = srs_cards.id)
WHERE EXISTS (SELECT 1 FROM reviews r WHERE r.card_id = srs_cards.id);

-- The Pleco import marked words in the personal "Words" and "Duo Chars" categories as learning
-- even when they had never been tested. Words never reviewed in Pleco or in this app, and never
-- met in a chat, go back to the pool and lose their (unseen) card.
DELETE FROM srs_cards WHERE item_type = 'word' AND id IN (
  SELECT s.id FROM srs_cards s JOIN words w ON w.id = s.item_id
  WHERE s.item_type = 'word' AND w.source = 'pleco_import' AND w.status = 'learning'
    AND json_extract(w.meta_json, '$.pleco.reviewed') IS NULL
    AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.card_id = s.id)
    AND NOT EXISTS (SELECT 1 FROM exposures e WHERE e.word_id = w.id)
);
UPDATE words SET status = 'new'
WHERE source = 'pleco_import' AND status = 'learning'
  AND json_extract(meta_json, '$.pleco.reviewed') IS NULL
  AND NOT EXISTS (SELECT 1 FROM srs_cards s WHERE s.item_type = 'word' AND s.item_id = words.id);

INSERT OR IGNORE INTO settings(key, value) VALUES ('review.new_per_day', '10');
