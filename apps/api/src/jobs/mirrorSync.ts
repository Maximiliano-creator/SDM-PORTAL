import { logger } from '../logger.js';
import { termRequest, UpstreamError } from '../upstream/termAdmin.js';
import { upsertScales, upsertShops, recordSync } from '../db/mirror.js';
import { getSetting } from '../db/settings.js';
import type { Scale, Shop } from '@sdm/shared';

const DEFAULT_INTERVAL_MS = 15_000; // 10 min
let timer: NodeJS.Timeout | null = null;
let running = false;

async function syncDataset<T>(
  dataset: 'scales' | 'shops',
  fetcher: () => Promise<T[]>,
  upsert: (rows: T[]) => void,
): Promise<void> {
  const startedAt = Date.now();
  try {
    const rows = await fetcher();
    upsert(rows);
    const durationMs = Date.now() - startedAt;
    recordSync(dataset, { status: 'ok', durationMs, rows: rows.length });
    logger.info({ dataset, rows: rows.length, durationMs }, 'Mirror sync ok');
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const error =
      err instanceof UpstreamError
        ? `${err.code}: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    recordSync(dataset, { status: 'error', durationMs, error });
    logger.warn({ dataset, durationMs, error }, 'Mirror sync failed');
  }
}

export async function runSyncOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await Promise.all([
      syncDataset<Scale>('scales', () => termRequest<Scale[]>('/api/termInfo/all'), upsertScales),
      syncDataset<Shop>('shops', () => termRequest<Shop[]>('/api/shopInfo/all'), upsertShops),
    ]);
  } finally {
    running = false;
  }
}

export function startMirrorJobs(): void {
  const intervalMs = Number(getSetting('mirror.sync_interval_ms') ?? '') || DEFAULT_INTERVAL_MS;
  // Primer sync en background; no bloquea el boot.
  setImmediate(() => {
    runSyncOnce().catch((err) => logger.error({ err }, 'Mirror initial sync threw'));
  });
  timer = setInterval(() => {
    runSyncOnce().catch((err) => logger.error({ err }, 'Mirror sync threw'));
  }, intervalMs);
  if (timer.unref) timer.unref();
  logger.info({ intervalMs }, 'Mirror sync jobs started');
}

export function stopMirrorJobs(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
