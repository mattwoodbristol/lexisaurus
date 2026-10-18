-- Language rows exist so that words.lang / topics.lang foreign keys resolve.
-- The real configuration lives in code (src/core/languages); config_json is a stub.
INSERT OR IGNORE INTO languages(id, config_json) VALUES ('zh', '{"name":"Mandarin Chinese"}'), ('it', '{"name":"Italian"}');
