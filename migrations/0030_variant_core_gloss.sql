-- A gloss that is only a cross-reference to another headword ("variant of 那 nà", "same as 哪",
-- "old variant of 這|这") takes that word's meaning instead. 0029 cleared the Pleco ones whose headword
-- was cut off; these kept it (word sheets, Claude). Without a usable target the gloss is cleared, so
-- Claude glosses the word afresh (its prompts now give the core meaning, never "variant of").
CREATE TABLE xref_fix AS
WITH x AS (
  SELECT id, lang, CASE
    WHEN lower(gloss) GLOB 'variant of [^ -~]*' THEN substr(gloss, 12)
    WHEN lower(gloss) GLOB '[a-z]* variant of [^ -~]*' AND instr(lower(gloss), ';') = 0 AND instr(lower(gloss), ',') = 0
      THEN substr(gloss, instr(lower(gloss), 'variant of ') + 11)
    WHEN lower(gloss) GLOB 'same as [^ -~]*' THEN substr(gloss, 9)
    WHEN lower(gloss) GLOB 'abbr. for [^ -~]*' THEN substr(gloss, 11)
    WHEN lower(gloss) GLOB 'abbr. of [^ -~]*' THEN substr(gloss, 10)
  END AS rest
  FROM words WHERE gloss IS NOT NULL
), t AS (
  -- The headword: up to the first space; of "trad|simp", the simplified.
  SELECT id, lang, CASE WHEN instr(rest, ' ') > 0 THEN substr(rest, 1, instr(rest, ' ') - 1) ELSE rest END AS hw
  FROM x WHERE rest IS NOT NULL
)
SELECT t.id, (
  SELECT w.gloss FROM words w
  WHERE w.lang = t.lang AND w.id <> t.id AND w.gloss IS NOT NULL
    AND w.lemma = CASE WHEN instr(t.hw, '|') > 0 THEN substr(t.hw, instr(t.hw, '|') + 1) ELSE t.hw END
    AND lower(w.gloss) NOT LIKE '%variant of%' AND lower(w.gloss) NOT LIKE 'same as%' AND lower(w.gloss) NOT LIKE 'abbr%'
) AS gloss
FROM t;

UPDATE words SET gloss = (SELECT f.gloss FROM xref_fix f WHERE f.id = words.id)
WHERE id IN (SELECT id FROM xref_fix);
DROP TABLE xref_fix;

-- A real meaning followed by a cross-reference ("that; variant of 那 nà") keeps only the meaning.
UPDATE words SET gloss = rtrim(substr(gloss, 1, instr(lower(gloss), '; variant of ') - 1), ' ;,')
WHERE instr(lower(gloss), '; variant of ') > 1;
UPDATE words SET gloss = rtrim(substr(gloss, 1, instr(lower(gloss), '; same as ') - 1), ' ;,')
WHERE instr(lower(gloss), '; same as ') > 1;

-- Claude-written glosses for words not in the list: a cross-reference is regenerated on next lookup.
DELETE FROM gloss_cache WHERE lower(gloss) LIKE '%variant of %' OR lower(gloss) GLOB 'same as [^ -~]*';
