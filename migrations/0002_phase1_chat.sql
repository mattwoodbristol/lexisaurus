-- Phase 1: chat, word metadata, cached annotations.
ALTER TABLE words ADD COLUMN meta_json TEXT;                 -- HSK level, categories, Pleco score, lesson tag, notes
ALTER TABLE conversations ADD COLUMN title TEXT;
ALTER TABLE messages ADD COLUMN tokens_json TEXT;            -- annotated tokens for assistant messages
ALTER TABLE messages ADD COLUMN translation TEXT;            -- cached English translation (the 'e' shortcut)
CREATE INDEX IF NOT EXISTS conversations_lang_started ON conversations(lang, started_at DESC);
