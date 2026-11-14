-- Follow-up to 0033 (asked for 2026-11-06): that clean-up only took lone characters chats and
-- lessons added that were still 'learning'. Ones that had graduated to 'known' kept their review
-- cards, so Review still tested them, with pinyin and no meaning (they are pieces of words). These
-- go too, whatever their status, with their review cards, history, cached sentences and exposures.
-- Characters the learner added by tapping (source 'manual') and imported ones are kept.
DELETE FROM reviews WHERE card_id IN (SELECT id FROM srs_cards WHERE item_type = 'word' AND item_id IN (SELECT id FROM words WHERE lang = 'zh' AND source IN ('conversation', 'lesson') AND length(lemma) = 1));
DELETE FROM srs_cards WHERE item_type = 'word' AND item_id IN (SELECT id FROM words WHERE lang = 'zh' AND source IN ('conversation', 'lesson') AND length(lemma) = 1);
DELETE FROM exercises WHERE item_type = 'word' AND item_id IN (SELECT id FROM words WHERE lang = 'zh' AND source IN ('conversation', 'lesson') AND length(lemma) = 1);
DELETE FROM exposures WHERE word_id IN (SELECT id FROM words WHERE lang = 'zh' AND source IN ('conversation', 'lesson') AND length(lemma) = 1);
DELETE FROM words WHERE lang = 'zh' AND source IN ('conversation', 'lesson') AND length(lemma) = 1;
