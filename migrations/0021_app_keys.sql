-- Keys the Worker generates for itself on first use (session signing, Web Push), so a new owner
-- only has to supply a passphrase and an API key. A secret of the same name on the Worker wins.
-- Kept out of `settings` because the settings API returns every row.
CREATE TABLE app_keys (
  name  TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
