-- Indexes that keep D1 rows read down (the free plan allows 5M a day and enforces it).
-- The word-level cron asks for unbanded words every 15 minutes; once every word has a band this
-- partial index is empty, so the question costs nothing instead of a scan of the word list.
CREATE INDEX words_unbanded ON words(id) WHERE level IS NULL;
-- The sort pile counts the words of one level sorted since the pile began.
CREATE INDEX words_lang_level_triaged ON words(lang, level, triaged_at);
