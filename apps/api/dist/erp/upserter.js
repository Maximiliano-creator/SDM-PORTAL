import { setTimeout as sleep } from 'node:timers/promises';
import { termRequest, UpstreamError } from '../upstream/termAdmin.js';
import { logger } from '../logger.js';
import { getSetting } from '../db/settings.js';
const DEFAULT_CONCURRENCY = 4;
const activeShopSyncs = new Set();
export async function lookupShopId(shopCode) {
    const shops = await termRequest('/api/shopInfo/all');
    const active = shops.filter((s) => {
        const ext = s;
        return ext.deleteFlag !== 1 && ext.shopStatus !== false;
    });
    return active.find((s) => s.shopCode === shopCode)?.shopId ?? null;
}
async function lookupExistingByPlu(shopId, goodsPlu) {
    const r = await termRequest('/api/shopGoodsInfo', {
        query: { page: 0, size: 1, shopId, goodsPlu },
    });
    return r.content.find((p) => p.goodsPlu === goodsPlu && p.shopId === shopId) ?? null;
}
async function listAllShopProducts(shopId) {
    const all = [];
    const PAGE_SIZE = 200;
    let page = 0;
    while (true) {
        const res = await termRequest('/api/shopGoodsInfo', {
            query: { page, size: PAGE_SIZE, shopId },
        });
        const batch = res.content.filter((p) => p.shopId === shopId);
        all.push(...batch);
        if (res.last || res.content.length < PAGE_SIZE)
            break;
        page++;
    }
    return all;
}
function isRetriable(err) {
    if (err instanceof UpstreamError) {
        return err.code === 'UPSTREAM_UNREACHABLE' || err.code === 'UPSTREAM_5XX';
    }
    return false;
}
async function withRetry(attempt, maxRetries, baseMs) {
    let lastErr;
    for (let i = 0; i <= maxRetries; i++) {
        try {
            return await attempt();
        }
        catch (err) {
            lastErr = err;
            if (i === maxRetries || !isRetriable(err))
                throw err;
            const delay = baseMs * Math.pow(2, i) + Math.floor(Math.random() * 100);
            await sleep(delay);
        }
    }
    throw lastErr;
}
async function runWithConcurrency(items, limit, worker) {
    let cursor = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const i = cursor++;
            const item = items[i];
            if (item === undefined)
                continue;
            await worker(item, i);
        }
    });
    await Promise.all(runners);
}
/**
 * Upsert por PLU en BLS via `shopGoodsInfo` autenticado.
 * En mode === 'full', elimina de la tienda los PLUs que no vienen en el lote.
 */
export async function upsertProducts(items, opts = {}) {
    const shopId = opts.shopId ?? items[0]?.shopId;
    if (shopId === undefined) {
        return performUpsertProducts(items, opts);
    }
    if (activeShopSyncs.has(shopId)) {
        throw new Error('Ya hay una sincronización ERP en curso para esta tienda.');
    }
    activeShopSyncs.add(shopId);
    try {
        return await performUpsertProducts(items, opts);
    }
    finally {
        activeShopSyncs.delete(shopId);
    }
}
async function performUpsertProducts(items, opts = {}) {
    const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
    const maxRetries = opts.maxRetries ?? Number(getSetting('erp.max_retries') ?? '3');
    const retryBaseMs = opts.retryBaseMs ?? Number(getSetting('erp.retry_base_ms') ?? '500');
    const result = {
        total: items.length,
        created: 0,
        updated: 0,
        deleted: 0,
        failed: 0,
        errors: [],
    };
    let processed = 0;
    await runWithConcurrency(items, concurrency, async (it, idx) => {
        try {
            await withRetry(async () => {
                const existing = await lookupExistingByPlu(it.shopId, it.goodsPlu);
                if (existing) {
                    const merged = { ...existing, ...it, shopGoodId: existing.shopGoodId };
                    await termRequest('/api/shopGoodsInfo', { method: 'PUT', body: merged });
                    result.updated++;
                }
                else {
                    await termRequest('/api/shopGoodsInfo', { method: 'POST', body: it });
                    result.created++;
                }
            }, maxRetries, retryBaseMs);
        }
        catch (err) {
            result.failed++;
            const msg = err instanceof Error ? err.message : String(err);
            result.errors.push({ row: idx + 1, plu: it.goodsPlu, error: msg });
            logger.warn({ row: idx + 1, plu: it.goodsPlu, error: msg }, 'ERP upsert failed');
        }
        finally {
            processed++;
            opts.onProgress?.(processed, items.length);
        }
    });
    // Borrado de faltantes cuando mode === 'full' (con salvaguarda: nunca vaciar con lote vacío)
    const targetShopId = opts.shopId ?? items[0]?.shopId;
    if (opts.mode === 'full' &&
        targetShopId !== undefined &&
        items.length > 0 &&
        result.failed === 0) {
        const incomingPlus = new Set(items.map((it) => String(it.goodsPlu)));
        try {
            const currentProducts = await listAllShopProducts(targetShopId);
            const toDelete = currentProducts.filter((p) => !incomingPlus.has(String(p.goodsPlu)));
            const DELETE_BATCH = 100;
            for (let i = 0; i < toDelete.length; i += DELETE_BATCH) {
                const chunk = toDelete.slice(i, i + DELETE_BATCH);
                const ids = chunk.map((p) => p.shopGoodId);
                await withRetry(async () => {
                    await termRequest('/api/shopGoodsInfo', { method: 'DELETE', body: ids });
                }, maxRetries, retryBaseMs);
                result.deleted += chunk.length;
            }
            if (toDelete.length > 0) {
                logger.info({ shopId: targetShopId, deleted: result.deleted }, 'ERP full sync deleted missing products');
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            result.errors.push({ row: 0, plu: '*', error: `Error al eliminar faltantes en mode full: ${msg}` });
            logger.warn({ shopId: targetShopId, error: msg }, 'ERP full sync delete step failed');
        }
    }
    else if (opts.mode === 'full' && result.failed > 0) {
        result.errors.push({
            row: 0,
            plu: '*',
            error: 'Se omitió el borrado de faltantes porque hubo productos fallidos en el lote.',
        });
    }
    return result;
}
//# sourceMappingURL=upserter.js.map