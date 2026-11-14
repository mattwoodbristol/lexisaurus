-- Pleco's export marks a link to another entry with private-use characters around the entry's id,
-- and the import kept them: "abbreviation = \uEAB8\uEABB22930176\uEABC" (the link's Hanzi were cut off,
-- see 0029), shown as boxes and a number. Keep the text before the first mark; when that is only a
-- label ("abbreviation =", "see", "variant of") the gloss is cleared, so the word is glossed afresh;
-- a trailing pointer ("fertilizer; see") is trimmed off.
CREATE TABLE pleco_mark_fix AS
WITH RECURSIVE c(id, g, i) AS (
  SELECT id, gloss, 1 FROM words WHERE gloss GLOB '*[-]*'
  UNION ALL
  SELECT id, g, i + 1 FROM c WHERE i < length(g) AND NOT substr(g, i, 1) GLOB '[-]'
)
SELECT id, rtrim(trim(substr(g, 1, max(i) - 1)), ' =;,:(') AS head FROM c GROUP BY id;

UPDATE words SET gloss = (
  SELECT CASE
    WHEN lower(f.head) IN (
      '', 'abbreviation', 'abbr.', 'abbr', 'abbreviation for', 'abbreviation of', 'abbr. for', 'abbr. of',
      'see', 'see also', 'cf.', 'same as', 'variant of', 'old variant of', 'used in', 'also written', 'short for'
    ) THEN NULL
    -- A meaning followed by a pointer to the link: "fertilizer; see".
    WHEN lower(f.head) LIKE '%; see also' THEN rtrim(substr(f.head, 1, length(f.head) - 8), ' ;,')
    WHEN lower(f.head) LIKE '%; see' OR lower(f.head) LIKE '%; cf.' THEN rtrim(substr(f.head, 1, length(f.head) - 3), ' ;,')
    ELSE f.head
  END
  FROM pleco_mark_fix f WHERE f.id = words.id
)
WHERE id IN (SELECT id FROM pleco_mark_fix);
DROP TABLE pleco_mark_fix;
