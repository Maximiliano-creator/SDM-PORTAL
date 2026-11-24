CREATE TABLE IF NOT EXISTS erp_api_keys (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,
  key_prefix   TEXT NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  created_by   INTEGER,
  last_used_at TEXT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ix_erp_api_keys_enabled ON erp_api_keys(enabled);

CREATE TABLE IF NOT EXISTS erp_sync_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  api_key_id   INTEGER,
  api_key_name TEXT,
  source       TEXT NOT NULL,
  shop_code    TEXT,
  mode         TEXT NOT NULL DEFAULT 'incremental',
  status       TEXT NOT NULL DEFAULT 'running',
  total        INTEGER NOT NULL DEFAULT 0,
  created      INTEGER NOT NULL DEFAULT 0,
  updated      INTEGER NOT NULL DEFAULT 0,
  failed       INTEGER NOT NULL DEFAULT 0,
  duration_ms  INTEGER,
  errors_json  TEXT,
  client_ip    TEXT,
  request_id   TEXT,
  started_at   TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at     TEXT,
  FOREIGN KEY (api_key_id) REFERENCES erp_api_keys(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ix_erp_sync_log_started_at ON erp_sync_log(started_at DESC);
CREATE INDEX IF NOT EXISTS ix_erp_sync_log_api_key_id ON erp_sync_log(api_key_id);

INSERT OR IGNORE INTO app_settings (key, value) VALUES
  ('erp.batch_size',       '500'),
  ('erp.max_retries',      '3'),
  ('erp.retry_base_ms',    '500'),
  ('erp.max_items_per_request', '20000');
