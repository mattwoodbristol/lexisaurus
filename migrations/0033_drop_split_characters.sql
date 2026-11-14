-- One-off clean-up (asked for 2026-11-05): chats and lessons used to add a lone unknown character
-- as a learning word when the segmenter split it off a longer word (解释 read as 解 + 释 with 解
-- on the list), so Review tested 释 on its own. Those words go, with their review cards, history,
-- cached sentences and exposures. Characters the learner added by tapping (source 'manual'),
-- imported ones and ones already known are kept.
DELETE FROM reviews WHERE card_id IN (SELECT id FROM srs_cards WHERE item_type = 'word' AND item_id IN (SELECT id FROM words WHERE lang = 'zh' AND source IN ('conversation', 'lesson') AND status = 'learning' AND length(lemma) = 1));
DELETE FROM srs_cards WHERE item_type = 'word' AND item_id IN (SELECT id FROM words WHERE lang = 'zh' AND source IN ('conversation', 'lesson') AND status = 'learning' AND length(lemma) = 1);
DELETE FROM exercises WHERE item_type = 'word' AND item_id IN (SELECT id FROM words WHERE lang = 'zh' AND source IN ('conversation', 'lesson') AND status = 'learning' AND length(lemma) = 1);
DELETE FROM exposures WHERE word_id IN (SELECT id FROM words WHERE lang = 'zh' AND source IN ('conversation', 'lesson') AND status = 'learning' AND length(lemma) = 1);
DELETE FROM words WHERE id IN (SELECT id FROM words WHERE lang = 'zh' AND source IN ('conversation', 'lesson') AND status = 'learning' AND length(lemma) = 1);
