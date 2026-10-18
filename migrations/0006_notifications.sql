-- Phase 3: reminders.
CREATE TABLE notifications_log (
  id         INTEGER PRIMARY KEY,
  lang       TEXT NOT NULL,
  local_date TEXT NOT NULL,                  -- YYYY-MM-DD in the learner's time zone
  slot       TEXT NOT NULL,                  -- "HH:MM" or "test"
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  url        TEXT NOT NULL,
  sent_to    INTEGER NOT NULL DEFAULT 0,     -- subscriptions the push service accepted
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX notifications_slot ON notifications_log(lang, local_date, slot) WHERE slot <> 'test';

ALTER TABLE push_subscriptions ADD COLUMN last_status INTEGER;
ALTER TABLE push_subscriptions ADD COLUMN last_sent_at TEXT;

INSERT OR IGNORE INTO settings(key, value) VALUES
  ('tz', '"Europe/London"'),
  ('zh.notify_times', '["07:30","19:30"]'),
  ('notify.quiet', '{"start":"22:00","end":"07:00"}'),
  ('notify.enabled', 'true'),
  ('session.min_chat_turns', '3');
