-- Spanish and French: language rows so words.lang / topics.lang foreign keys resolve (see 0003).
INSERT OR IGNORE INTO languages(id, config_json) VALUES ('es', '{"name":"Spanish"}'), ('fr', '{"name":"French"}');
