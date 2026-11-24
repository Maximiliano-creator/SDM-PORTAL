import { getSetting } from '../../db/settings.js';
import { UpstreamError } from '../../upstream/termAdmin.js';
import { logger } from '../../logger.js';
/**
 * Sirve un dataset con fallback automático mirror ↔ upstream:
 *
 * 1) Si el cliente NO mandó `?fresh=1` y el mirror tiene datos →
 *    responde inmediatamente desde el mirror y agrega
 *    `X-Data-Stale: <segundos>` cuando el último sync exitoso es
 *    más viejo que `mirror.stale_after_ms` (default 15 min).
 * 2) Si pidió fresh, o el mirror está vacío, intenta upstream.
 *    Si upstream falla y hay datos en el mirror, los devuelve igual
 *    con `X-Data-Stale` reflejando la edad real.
 * 3) Si no hay nada ni en mirror ni en upstream, propaga el error.
 */
export async function serveWithMirror(res, opts) {
    const staleAfterMs = Number(getSetting('mirror.stale_after_ms') ?? '') || 900_000;
    const mirror = opts.getMirror();
    const mirrorHasData = mirrorIsPopulated(mirror.data);
    // 1) Si NO pidió fresh y el mirror está poblado, responder del mirror.
    if (!opts.fresh && mirrorHasData) {
        setStaleHeader(res, mirror.syncedAt, staleAfterMs);
        res.setHeader('X-Data-Source', 'mirror');
        return { ok: true, data: mirror.data };
    }
    // 2) Intentar upstream. Si va bien, devolver fresh.
    try {
        const live = await opts.fetchLive();
        res.setHeader('X-Data-Source', 'live');
        return { ok: true, data: live };
    }
    catch (err) {
        if (mirrorHasData) {
            logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Upstream falló, sirvo desde mirror');
            setStaleHeader(res, mirror.syncedAt, staleAfterMs);
            res.setHeader('X-Data-Source', 'mirror-fallback');
            return { ok: true, data: mirror.data };
        }
        return { error: err };
    }
}
function setStaleHeader(res, syncedAt, staleAfterMs) {
    if (!syncedAt)
        return;
    const ts = Date.parse(syncedAt);
    if (!Number.isFinite(ts))
        return;
    const ageMs = Date.now() - ts;
    const ageSec = Math.max(0, Math.floor(ageMs / 1000));
    res.setHeader('X-Data-Stale-Seconds', String(ageSec));
    if (ageMs > staleAfterMs) {
        res.setHeader('X-Data-Stale', 'true');
    }
    res.setHeader('X-Data-Synced-At', syncedAt);
}
function mirrorIsPopulated(data) {
    if (Array.isArray(data))
        return data.length > 0;
    if (data && typeof data === 'object')
        return Object.keys(data).length > 0;
    return data != null;
}
export function isFresh(query) {
    if (typeof query !== 'object' || query === null)
        return false;
    const q = query;
    const v = q.fresh;
    return v === '1' || v === 'true' || v === true;
}
export function upstreamErrorStatus(err) {
    if (err instanceof UpstreamError)
        return err.status;
    return 500;
}
//# sourceMappingURL=mirrorServe.js.map