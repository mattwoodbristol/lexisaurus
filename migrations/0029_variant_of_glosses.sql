-- The Pleco import cut each definition at its first Hanzi, so a cross-reference ("variant of 那 nà",
-- "same as 哪") kept only its label. Those glosses carry no meaning: clear them, so the word is
-- glossed afresh (by Claude) the next time it is looked up, sorted or reviewed. A label left at the
-- end of a real gloss ("that; variant of") is trimmed off.
UPDATE words SET gloss = NULL
WHERE lower(trim(rtrim(trim(gloss), ';,'))) IN (
  'variant of', 'old variant of', 'erhua variant of', 'archaic variant of', 'ancient variant of',
  'japanese variant of', 'taiwan variant of', 'literary variant of', 'non-standard variant of',
  'traditional variant of', 'same as', 'abbr. for', 'abbr. of', 'abbr for', 'abbr of',
  'abbreviation for', 'abbreviation of', 'see also', 'used in', 'also written'
);

UPDATE words SET gloss = rtrim(trim(substr(trim(gloss), 1, length(trim(gloss)) - length('variant of'))), ';, ')
WHERE lower(trim(gloss)) LIKE '%; variant of' OR lower(trim(gloss)) LIKE '%, variant of';
UPDATE words SET gloss = rtrim(trim(substr(trim(gloss), 1, length(trim(gloss)) - length('same as'))), ';, ')
WHERE lower(trim(gloss)) LIKE '%; same as' OR lower(trim(gloss)) LIKE '%, same as';
