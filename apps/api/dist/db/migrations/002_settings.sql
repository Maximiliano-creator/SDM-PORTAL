CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO app_settings (key, value) VALUES
  ('term_admin.url',      'http://localhost:19697'),
  ('term_admin.username', 'admin'),
  ('branding.app_name',   'SDM Portal'),
  ('branding.primary',    '217 91% 45%');
