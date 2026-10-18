-- Course packs: lessons get a stable id from the pack, and the planned (not yet written) lessons
-- move from code into the database so a pack can define them.
ALTER TABLE lessons ADD COLUMN slug TEXT;
CREATE UNIQUE INDEX lessons_lang_slug ON lessons(lang, slug) WHERE slug IS NOT NULL;

CREATE TABLE course_plan (
  lang     TEXT NOT NULL,
  slug     TEXT NOT NULL,
  position INTEGER NOT NULL,
  title    TEXT NOT NULL,
  level    TEXT NOT NULL DEFAULT '',
  focus    TEXT NOT NULL,                   -- what the lesson should teach (sent to Claude)
  PRIMARY KEY (lang, slug)
);
