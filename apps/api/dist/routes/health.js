import { Router } from 'express';
import { pingTermAdmin } from '../upstream/termAdmin.js';
import { listSyncStates } from '../db/mirror.js';
import { getSetting } from '../db/settings.js';
import { runSyncOnce } from '../jobs/mirrorSync.js';
import { requireAuth } from '../auth/middleware.js';
const startedAt = Date.now();
export const healthRouter = Router();
healthRouter.get('/health', async (_req, res) => {
    const upstream = await pingTermAdmin();
    const states = listSyncStates();
    const staleAfterMs = Number(getSetting('mirror.stale_after_ms') ?? '') || 900_000;
    const now = Date.now();
    const datasets = states.map((s) => {
        const lastTs = s.last_success_at ? Date.parse(s.last_success_at) : NaN;
        const ageMs = Number.isFinite(lastTs) ? now - lastTs : null;
        return {
            dataset: s.dataset,
            lastSyncAt: s.last_sync_at,
            lastSuccessAt: s.last_success_at,
            lastStatus: s.last_status,
            lastError: s.last_error,
            ageSeconds: ageMs != null ? Math.floor(ageMs / 1000) : null,
            stale: ageMs == null || ageMs > staleAfterMs,
            rows: s.rows,
        };
    });
    const anyStale = datasets.some((d) => d.stale);
    const status = upstream.ok ? 'up' : 'degraded';
    res.json({
        ok: true,
        data: {
            status,
            version: process.env.npm_package_version ?? '0.1.0',
            uptime: Math.floor((Date.now() - startedAt) / 1000),
            upstream: {
                termAdmin: upstream.ok ? 'up' : 'down',
                termAdminVersion: upstream.version ?? null,
                termAdminError: upstream.error ?? null,
            },
            mirror: {
                stale: anyStale,
                staleAfterMs,
                datasets,
            },
        },
    });
});
healthRouter.post('/mirror/sync', requireAuth, async (_req, res) => {
    await runSyncOnce();
    const states = listSyncStates();
    res.json({ ok: true, data: { datasets: states } });
});
//# sourceMappingURL=health.js.map