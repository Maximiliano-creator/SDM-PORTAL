CREATE TABLE IF NOT EXISTS vnc_sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER,
  username     TEXT,
  term_id      INTEGER NOT NULL,
  ip           TEXT NOT NULL,
  client_ip    TEXT,
  request_id   TEXT,
  started_at   TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at     TEXT,
  ended_reason TEXT,
  bytes_up     INTEGER NOT NULL DEFAULT 0,
  bytes_down   INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ix_vnc_sessions_term_id ON vnc_sessions(term_id);
CREATE INDEX IF NOT EXISTS ix_vnc_sessions_started_at ON vnc_sessions(started_at DESC);

INSERT OR IGNORE INTO app_settings (key, value) VALUES
  ('websockify.url',        'ws://localhost:9000/websockify/'),
  ('websockify.token_file', 'C:\sdm\term_admin\websockify\token.conf'),
  ('vnc.port',              '5900'),
  ('vnc.idle_timeout_ms',   '300000'),
  ('vnc.max_session_ms',    '1800000');
