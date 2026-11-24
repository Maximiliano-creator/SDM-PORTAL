import { db } from './client.js';
import type { Scale, Shop } from '@sdm/shared';

export type MirrorDataset = 'scales' | 'shops';

interface MirrorScaleRow {
  term_id: number;
  shop_id: number | null;
  term_name: string | null;
  ip_address: string | null;
  online_status: number | null;
  payload: string;
  last_seen_at: string;
  synced_at: string;
}

interface MirrorShopRow {
  shop_id: number;
  shop_code: string | null;
  shop_name: string | null;
  payload: string;
  last_seen_at: string;
  synced_at: string;
}

const stmts = {
  upsertScale: db.prepare(`
    INSERT INTO mirror_scales
      (term_id, shop_id, term_name, ip_address, online_status, payload, last_seen_at, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(term_id) DO UPDATE SET
      shop_id = excluded.shop_id,
      term_name = excluded.term_name,
      ip_address = excluded.ip_address,
      online_status = excluded.online_status,
      payload = excluded.payload,
      last_seen_at = excluded.last_seen_at,
      synced_at = excluded.synced_at
  `),
  upsertShop: db.prepare(`
    INSERT INTO mirror_shops (shop_id, shop_code, shop_name, payload, last_seen_at, synced_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(shop_id) DO UPDATE SET
      shop_code = excluded.shop_code,
      shop_name = excluded.shop_name,
      payload = excluded.payload,
      last_seen_at = excluded.last_seen_at,
      synced_at = excluded.synced_at
  `),
  allScales: db.prepare<[], MirrorScaleRow>(`SELECT * FROM mirror_scales`),
  allShops: db.prepare<[], MirrorShopRow>(`SELECT * FROM mirror_shops`),
  countScales: db.prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM mirror_scales'),
  countShops: db.prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM mirror_shops'),
  syncStateGet: db.prepare<[MirrorDataset], MirrorSyncState>(
    'SELECT * FROM mirror_sync_state WHERE dataset = ?',
  ),
  syncStateAll: db.prepare<[], MirrorSyncState>(
    'SELECT * FROM mirror_sync_state',
  ),
  syncStateUpsert: db.prepare(`
    INSERT INTO mirror_sync_state
      (dataset, last_sync_at, last_success_at, last_error, last_status, last_duration_ms, rows)
    VALUES (@dataset, @last_sync_at, @last_success_at, @last_error, @last_status, @last_duration_ms, @rows)
    ON CONFLICT(dataset) DO UPDATE SET
      last_sync_at      = excluded.last_sync_at,
      last_success_at   = COALESCE(excluded.last_success_at, mirror_sync_state.last_success_at),
      last_error        = excluded.last_error,
      last_status       = excluded.last_status,
      last_duration_ms  = excluded.last_duration_ms,
      rows              = COALESCE(excluded.rows, mirror_sync_state.rows)
  `),
};

export interface MirrorSyncState {
  dataset: MirrorDataset;
  last_sync_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  last_status: 'ok' | 'error' | null;
  last_duration_ms: number | null;
  rows: number | null;
}

export function upsertScales(items: Scale[]): void {
  const tx = db.transaction((rows: Scale[]) => {
    for (const s of rows) {
      stmts.upsertScale.run(
        s.termId,
        s.shopId ?? null,
        s.termName ?? null,
        s.ipAddress ?? null,
        s.onlineStatus ?? null,
        JSON.stringify(s),
      );
    }
  });
  tx(items);
}

export function upsertShops(items: Shop[]): void {
  const active = items.filter((s) => (s as Shop & { deleteFlag?: number }).deleteFlag !== 1);
  const tx = db.transaction((rows: Shop[]) => {
    const activeIds = new Set(rows.map((r) => r.shopId));
    const existing = stmts.allShops.all();
    for (const row of existing) {
      if (!activeIds.has(row.shop_id)) {
        db.prepare('DELETE FROM mirror_shops WHERE shop_id = ?').run(row.shop_id);
      }
    }
    for (const s of rows) {
      stmts.upsertShop.run(
        s.shopId,
        s.shopCode ?? null,
        s.shopName ?? null,
        JSON.stringify(s),
      );
    }
  });
  tx(active);
}

export function getMirrorScales(): { data: Scale[]; syncedAt: string | null } {
  const rows = stmts.allScales.all();
  const data: Scale[] = rows.map((r) => JSON.parse(r.payload) as Scale);
  // Para staleness usamos el min(synced_at) â‰ˆ momento del Ãºltimo full sync.
  const syncedAt = rows.length === 0
    ? null
    : rows.reduce<string | null>((acc, r) => (acc === null || r.synced_at < acc ? r.synced_at : acc), null);
  return { data, syncedAt };
}

export function getMirrorShops(): { data: Shop[]; syncedAt: string | null } {
  const rows = stmts.allShops.all();
  const data: Shop[] = rows.map((r) => JSON.parse(r.payload) as Shop);
  const syncedAt = rows.length === 0
    ? null
    : rows.reduce<string | null>((acc, r) => (acc === null || r.synced_at < acc ? r.synced_at : acc), null);
  return { data, syncedAt };
}

export function countMirror(dataset: MirrorDataset): number {
  if (dataset === 'scales') return stmts.countScales.get()?.c ?? 0;
  if (dataset === 'shops') return stmts.countShops.get()?.c ?? 0;
  return 0;
}

export function getSyncState(dataset: MirrorDataset): MirrorSyncState | null {
  return stmts.syncStateGet.get(dataset) ?? null;
}

export function listSyncStates(): MirrorSyncState[] {
  return stmts.syncStateAll.all();
}

export function recordSync(
  dataset: MirrorDataset,
  result:
    | { status: 'ok'; durationMs: number; rows: number }
    | { status: 'error'; durationMs: number; error: string },
): void {
  const now = new Date().toISOString();
  stmts.syncStateUpsert.run({
    dataset,
    last_sync_at: now,
    last_success_at: result.status === 'ok' ? now : null,
    last_error: result.status === 'error' ? result.error : null,
    last_status: result.status,
    last_duration_ms: result.durationMs,
    rows: result.status === 'ok' ? result.rows : null,
  });
}
