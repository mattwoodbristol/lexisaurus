-- Grammar hints in chat: a tutor message may carry a nudge to use a grammar point from a finished
-- lesson. Stored as JSON {grammarPointId, text, title, lessonId}.
ALTER TABLE messages ADD COLUMN hint_json TEXT;
INSERT OR IGNORE INTO settings(key, value) VALUES ('chat.hint_every', '4');
