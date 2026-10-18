-- Corrections in chat: on a learner message, every mistake the tutor found with its severity and
-- whether it was shown under the message (the rest wait for the end-of-chat summary).
ALTER TABLE messages ADD COLUMN corrections_json TEXT;
INSERT OR IGNORE INTO settings(key, value) VALUES ('chat.corrections', '"balanced"');
