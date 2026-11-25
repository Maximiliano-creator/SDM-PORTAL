CREATE TABLE IF NOT EXISTS auth_sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_auth_sessions_user_id ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS ix_auth_sessions_expires_at ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  subject_hash       TEXT PRIMARY KEY,
  failures           INTEGER NOT NULL,
  window_started_at  INTEGER NOT NULL,
  blocked_until      INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE erp_api_keys
  ADD COLUMN can_distribute INTEGER NOT NULL DEFAULT 0;

DELETE FROM app_settings
WHERE key = 'term_admin.password';
