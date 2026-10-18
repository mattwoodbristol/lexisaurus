-- The learner's own language for the translate button. Cached translations record their language,
-- so changing it re-translates on the next tap.
ALTER TABLE messages ADD COLUMN translation_lang TEXT;
UPDATE messages SET translation_lang = 'en' WHERE translation IS NOT NULL;
INSERT OR IGNORE INTO settings(key, value) VALUES ('native_lang', '"en"');
