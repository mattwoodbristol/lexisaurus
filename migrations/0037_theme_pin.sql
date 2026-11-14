-- Theme words not reviewed yet were pinned like word-sheet words (1), so they went to the front of
-- every review. They get their own pin (2): still outside the new-word ration, but mixed in.
UPDATE srs_cards SET pinned = 2
WHERE pinned = 1 AND item_type = 'word' AND json_extract(fsrs_state_json, '$.reps') = 0
  AND item_id IN (
    SELECT w.id FROM themes t
    JOIN json_each(t.content_json, '$.sections') sec
    JOIN json_each(sec.value, '$.items') it
    JOIN words w ON w.lang = t.lang AND w.lemma = json_extract(it.value, '$.lemma')
  );
