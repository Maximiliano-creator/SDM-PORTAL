-- Mirror local de datasets clave de term_admin para modo offline.
-- Guardamos el payload upstream completo como JSON + columnas indexables
-- para las queries más comunes. last_seen_at = última vez que la fila se
-- vio en el upstream (sirve para detectar bajas si hacemos diff).

CREATE TABLE IF NOT EXISTS mirror_scales (
  term_id        INTEGER PRIMARY KEY,
  shop_id        INTEGER,
  term_name      TEXT,
  ip_address     TEXT,
  online_status  INTEGER,
  payload        TEXT NOT NULL,
  last_seen_at   TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS ix_mirror_scales_shop_id ON mirror_scales(shop_id);
CREATE INDEX IF NOT EXISTS ix_mirror_scales_online ON mirror_scales(online_status);

CREATE TABLE IF NOT EXISTS mirror_shops (
  shop_id      INTEGER PRIMARY KEY,
  shop_code    TEXT,
  shop_name    TEXT,
  payload      TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS ix_mirror_shops_shop_code ON mirror_shops(shop_code);

-- Estado del sync por dataset.  status: ok | error.  Único registro por dataset.
CREATE TABLE IF NOT EXISTS mirror_sync_state (
  dataset           TEXT PRIMARY KEY,
  last_sync_at      TEXT,
  last_success_at   TEXT,
  last_error        TEXT,
  last_status       TEXT,
  last_duration_ms  INTEGER,
  rows              INTEGER
);

INSERT OR IGNORE INTO app_settings (key, value) VALUES
  ('mirror.sync_interval_ms', '600000'),
  ('mirror.stale_after_ms',   '900000');
