import { logger } from '../logger.js';
import { termRequest, UpstreamError } from '../upstream/termAdmin.js';
import { upsertScales, upsertShops, recordSync } from '../db/mirror.js';
import { getSetting } from '../db/settings.js';
const DEFAULT_INTERVAL_MS = 15_000; // 10 min
let timer = null;
let running = false;
async function syncDataset(dataset, fetcher, upsert) {
    const startedAt = Date.now();
    try {
        const rows = await fetcher();
        upsert(rows);
        const durationMs = Date.now() - startedAt;
        recordSync(dataset, { status: 'ok', durationMs, rows: rows.length });
        logger.info({ dataset, rows: rows.length, durationMs }, 'Mirror sync ok');
    }
    catch (err) {
        const durationMs = Date.now() - startedAt;
        const error = err instanceof UpstreamError
            ? `${err.code}: ${err.message}`
            : err instanceof Error
                ? err.message
                : String(err);
        recordSync(dataset, { status: 'error', durationMs, error });
        logger.warn({ dataset, durationMs, error }, 'Mirror sync failed');
    }
}
export async function runSyncOnce() {
    if (running)
        return;
    running = true;
    try {
        await Promise.all([
            syncDataset('scales', () => termRequest('/api/termInfo/all'), upsertScales),
            syncDataset('shops', () => termRequest('/api/shopInfo/all'), upsertShops),
        ]);
    }
    finally {
        running = false;
    }
}
export function startMirrorJobs() {
    const intervalMs = Number(getSetting('mirror.sync_interval_ms') ?? '') || DEFAULT_INTERVAL_MS;
    // Primer sync en background; no bloquea el boot.
    setImmediate(() => {
        runSyncOnce().catch((err) => logger.error({ err }, 'Mirror initial sync threw'));
    });
    timer = setInterval(() => {
        runSyncOnce().catch((err) => logger.error({ err }, 'Mirror sync threw'));
    }, intervalMs);
    if (timer.unref)
        timer.unref();
    logger.info({ intervalMs }, 'Mirror sync jobs started');
}
export function stopMirrorJobs() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}
//# sourceMappingURL=mirrorSync.js.map