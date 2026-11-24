import { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import { ErpPushPayloadSchema, ErpProductInputSchema } from '@sdm/shared';
import { requireAuth } from '../auth/middleware.js';
import { authenticateApiKey, createApiKey, deleteApiKey, listApiKeys, setApiKeyEnabled } from '../erp/apiKeys.js';
import { csvHeaderToErpKey, toShopGoodsBase } from '../erp/mapErp.js';
import { parseCsv } from '../erp/csv.js';
import { lookupShopId, upsertProducts } from '../erp/upserter.js';
import { db } from '../db/client.js';
import { logger } from '../logger.js';
import { termRequest } from '../upstream/termAdmin.js';
import { normalizeDistributionTypes } from '../upstream/distribution.js';
// =================== Public push (API key) ===================
// Se exporta aparte para montarlo ANTES del body-parser global de 4 MB
// y de los routers que usan requireAuth.
export const erpPublicRouter = Router();
// JSON hasta 32 MB para este endpoint; el resto del API queda en 4 MB.
erpPublicRouter.use(express.json({ limit: '32mb' }));
// CSV / texto plano hasta 32 MB.
erpPublicRouter.use(express.text({ type: ['text/csv', 'text/plain'], limit: '32mb' }));
function requireApiKey(req, res, next) {
    const headerKey = req.header('x-api-key');
    const auth = req.header('authorization');
    const bearer = auth?.toLowerCase().startsWith('apikey ')
        ? auth.slice('apikey '.length).trim()
        : null;
    const raw = (headerKey ?? bearer ?? '').trim();
    if (!raw) {
        res.status(401).json({
            ok: false,
            error: { code: 'NO_API_KEY', message: 'X-Api-Key requerido' },
        });
        return;
    }
    const row = authenticateApiKey(raw);
    if (!row) {
        res.status(401).json({
            ok: false,
            error: { code: 'INVALID_API_KEY', message: 'API key invÃƒÂ¡lida o deshabilitada' },
        });
        return;
    }
    req.apiKey = { id: row.id, name: row.name };
    next();
}
const insertSync = db.prepare(`
  INSERT INTO erp_sync_log
    (api_key_id, api_key_name, source, shop_code, mode, status, client_ip, request_id, started_at)
  VALUES (?, ?, ?, ?, ?, 'running', ?, ?, datetime('now'))
`);
const updateSync = db.prepare(`
  UPDATE erp_sync_log
  SET status = ?, total = ?, created = ?, updated = ?, deleted = ?, failed = ?,
      duration_ms = ?, errors_json = ?, ended_at = datetime('now')
  WHERE id = ?
`);
erpPublicRouter.post('/products', requireApiKey, async (req, res, next) => {
    const apiKey = req.apiKey;
    const ct = (req.header('content-type') ?? '').toLowerCase();
    const source = ct.includes('csv') ? 'csv' : ct.includes('json') ? 'json' : 'text';
    try {
        let items = [];
        let shopCode = null;
        let mode = 'incremental';
        if (typeof req.body === 'string') {
            // CSV body: shop_code y mode vienen como query params
            const csvShop = typeof req.query.shop_code === 'string' ? req.query.shop_code : null;
            const csvMode = req.query.mode === 'full' ? 'full' : 'incremental';
            if (!csvShop) {
                res.status(400).json({
                    ok: false,
                    error: {
                        code: 'MISSING_SHOP_CODE',
                        message: 'En CSV se requiere ?shop_code=... en la URL',
                    },
                });
                return;
            }
            const rows = parseCsv(req.body);
            const parsedItems = [];
            for (let r = 0; r < rows.length; r++) {
                const row = rows[r];
                const normalized = {};
                for (const [k, v] of Object.entries(row)) {
                    const mapped = csvHeaderToErpKey(k);
                    if (mapped && v !== '')
                        normalized[mapped] = v;
                }
                const parsed = ErpProductInputSchema.safeParse(normalized);
                if (!parsed.success) {
                    res.status(400).json({
                        ok: false,
                        error: {
                            code: 'CSV_ROW_INVALID',
                            message: `Fila CSV ${r + 2} invÃƒÂ¡lida`,
                            details: parsed.error.flatten(),
                        },
                    });
                    return;
                }
                parsedItems.push(parsed.data);
            }
            items = parsedItems;
            shopCode = csvShop;
            mode = csvMode;
        }
        else {
            const parsed = ErpPushPayloadSchema.safeParse(req.body);
            if (!parsed.success) {
                res.status(400).json({
                    ok: false,
                    error: {
                        code: 'VALIDATION',
                        message: 'Payload invÃƒÂ¡lido',
                        details: parsed.error.flatten(),
                    },
                });
                return;
            }
            items = parsed.data.items;
            shopCode = parsed.data.shop_code;
            mode = parsed.data.mode;
        }
        if (items.length === 0) {
            res.status(400).json({
                ok: false,
                error: { code: 'EMPTY', message: 'Sin items para procesar' },
            });
            return;
        }
        const requestId = req.headers['x-request-id'] ?? null;
        const startedAt = Date.now();
        const syncInfo = insertSync.run(apiKey.id, apiKey.name, source, shopCode, mode, req.ip ?? null, requestId);
        const syncId = Number(syncInfo.lastInsertRowid);
        try {
            const shopId = await lookupShopId(shopCode);
            if (shopId === null) {
                const dur = Date.now() - startedAt;
                updateSync.run('failed', items.length, 0, 0, 0, items.length, dur, JSON.stringify({ message: `Tienda no encontrada: ${shopCode}` }), syncId);
                res.status(400).json({
                    ok: false,
                    error: {
                        code: 'BAD_SHOP',
                        message: `Tienda no encontrada: ${shopCode}`,
                    },
                });
                return;
            }
            const mapped = items.map((it) => toShopGoodsBase(it, shopCode, shopId));
            const result = await upsertProducts(mapped, { mode, shopId });
            const durationMs = Date.now() - startedAt;
            const status = result.failed === 0 ? 'success' : result.created + result.updated > 0 ? 'partial' : 'failed';
            updateSync.run(status, result.total, result.created, result.updated, result.deleted, result.failed, durationMs, result.errors.length > 0 ? JSON.stringify(result.errors.slice(0, 200)) : null, syncId);
            res.json({
                ok: true,
                data: {
                    syncId,
                    shopCode,
                    mode,
                    total: result.total,
                    created: result.created,
                    updated: result.updated,
                    deleted: result.deleted,
                    failed: result.failed,
                    success: result.created + result.updated,
                    durationMs,
                    errors: result.errors.slice(0, 50),
                },
            });
        }
        catch (err) {
            const durationMs = Date.now() - startedAt;
            const msg = err instanceof Error ? err.message : String(err);
            updateSync.run('failed', items.length, 0, 0, 0, items.length, durationMs, JSON.stringify({ message: msg }), syncId);
            logger.error({ err, syncId }, 'ERP sync failed');
            next(err);
        }
    }
    catch (err) {
        next(err);
    }
});
const ErpDistributeSchema = z.object({
    shopId: z.number().int().optional(),
    targetTermIdList: z.array(z.number().int()).min(1, 'Debes indicar al menos un termId en targetTermIdList'),
    typeList: z
        .array(z.union([z.literal(0), z.literal(1), z.literal(2)]))
        .min(1, 'Debes indicar al menos un tipo de dato en typeList (0=PLUs, 1=Agrupación, 2=Imágenes)'),
});
erpPublicRouter.get('/scales', requireApiKey, async (_req, res, next) => {
    try {
        const scales = await termRequest('/api/termInfo/all');
        res.json({ ok: true, data: scales });
    }
    catch (err) {
        next(err);
    }
});
erpPublicRouter.post('/scales/distribute', requireApiKey, async (req, res, next) => {
    try {
        const parsed = ErpDistributeSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({
                ok: false,
                error: {
                    code: 'VALIDATION',
                    message: parsed.error.issues[0]?.message ?? 'Parámetros de envío inválidos',
                    details: parsed.error.flatten(),
                },
            });
            return;
        }
        const payload = {
            shopId: parsed.data.shopId ?? -1,
            targetTermIdList: parsed.data.targetTermIdList,
            typeList: normalizeDistributionTypes(parsed.data.typeList),
        };
        const upstreamResult = await termRequest('/api/termInfo/distributeData', {
            method: 'POST',
            body: payload,
        });
        res.json({
            ok: true,
            data: {
                sent: true,
                targetTermIdList: payload.targetTermIdList,
                typeList: payload.typeList,
                upstreamResult,
            },
        });
    }
    catch (err) {
        next(err);
    }
});
// GET /api/erp/products - Consulta de catálogo para POS/ERP
erpPublicRouter.get('/products', requireApiKey, async (req, res, next) => {
    try {
        const shopCode = typeof req.query.shop_code === 'string' ? req.query.shop_code.trim() : null;
        if (!shopCode) {
            res.status(400).json({
                ok: false,
                error: { code: 'MISSING_SHOP_CODE', message: 'Parámetro ?shop_code=... es requerido' },
            });
            return;
        }
        const shopId = await lookupShopId(shopCode);
        if (shopId === null) {
            res.status(404).json({
                ok: false,
                error: { code: 'SHOP_NOT_FOUND', message: `Tienda no encontrada: ${shopCode}` },
            });
            return;
        }
        const page = Math.max(0, Number(req.query.page) || 0);
        const size = Math.min(2000, Math.max(1, Number(req.query.size) || 50));
        const query = { page, size, shopId };
        if (typeof req.query.goodsPlu === 'string' && req.query.goodsPlu.trim()) {
            query.goodsPlu = req.query.goodsPlu.trim();
        }
        if (typeof req.query.goodsName === 'string' && req.query.goodsName.trim()) {
            query.goodsName = req.query.goodsName.trim();
        }
        const data = await termRequest('/api/shopGoodsInfo', { query });
        res.json({
            ok: true,
            data: {
                shopCode,
                shopId,
                content: data.content ?? [],
                totalElements: data.totalElements ?? 0,
                page,
                size,
                totalPages: data.totalPages ?? Math.ceil((data.totalElements ?? 0) / size),
            },
        });
    }
    catch (err) {
        next(err);
    }
});
// POST /api/erp/products/price - Actualización rápida de precio unitario por PLU para POS
const SinglePriceUpdateSchema = z.object({
    shop_code: z.string().min(1),
    goodsPlu: z.string().min(1),
    price: z.number().nonnegative().optional(),
    memberPrice: z.number().nonnegative().nullable().optional(),
    promotionPrice: z.number().nonnegative().nullable().optional(),
    distribute: z.boolean().default(false),
});
erpPublicRouter.post('/products/price', requireApiKey, async (req, res, next) => {
    try {
        const parsed = SinglePriceUpdateSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({
                ok: false,
                error: { code: 'VALIDATION', message: 'Datos de precio inválidos', details: parsed.error.flatten() },
            });
            return;
        }
        const { shop_code, goodsPlu, price, memberPrice, promotionPrice, distribute } = parsed.data;
        const shopId = await lookupShopId(shop_code);
        if (shopId === null) {
            res.status(404).json({
                ok: false,
                error: { code: 'SHOP_NOT_FOUND', message: `Tienda no encontrada: ${shop_code}` },
            });
            return;
        }
        const current = await termRequest('/api/shopGoodsInfo', {
            query: { page: 0, size: 5, shopId, goodsPlu },
        });
        const product = current.content?.find((p) => p.goodsPlu === goodsPlu && p.shopId === shopId);
        if (!product) {
            res.status(404).json({
                ok: false,
                error: { code: 'PLU_NOT_FOUND', message: `PLU ${goodsPlu} no existe en tienda ${shop_code}` },
            });
            return;
        }
        const updated = {
            ...product,
            price: price !== undefined ? price : product.price,
            memberPrice: memberPrice !== undefined ? memberPrice : product.memberPrice,
            promotionPrice: promotionPrice !== undefined ? promotionPrice : product.promotionPrice,
        };
        await termRequest('/api/shopGoodsInfo/modifyProductPrice', {
            method: 'POST',
            body: updated,
        });
        let distributed = false;
        let distributedTerms = [];
        if (distribute) {
            try {
                const allScales = await termRequest('/api/termInfo/all');
                const shopScales = (allScales ?? []).filter((s) => s.shopId === shopId && s.deleteFlag !== 1);
                if (shopScales.length > 0) {
                    const targetTermIdList = shopScales.map((s) => s.termId);
                    await termRequest('/api/termInfo/distributeData', {
                        method: 'POST',
                        body: {
                            shopId,
                            targetTermIdList,
                            typeList: [0, 1], // PLUs y Precios
                        },
                    });
                    distributed = true;
                    distributedTerms = targetTermIdList;
                }
            }
            catch (distErr) {
                logger.warn({ distErr }, 'Auto-distribute on single price update failed');
            }
        }
        res.json({
            ok: true,
            data: {
                shopCode: shop_code,
                goodsPlu,
                oldPrice: product.price,
                newPrice: updated.price,
                memberPrice: updated.memberPrice,
                promotionPrice: updated.promotionPrice,
                distributed,
                distributedScales: distributedTerms,
            },
        });
    }
    catch (err) {
        next(err);
    }
});
// GET /api/erp/shops - Listado de sucursales disponibles para integración
erpPublicRouter.get('/shops', requireApiKey, async (_req, res, next) => {
    try {
        const raw = await termRequest('/api/shopInfo/all');
        const active = (raw ?? [])
            .filter((s) => s.deleteFlag !== 1)
            .map((s) => ({
            shopId: s.shopId,
            shopCode: s.shopCode,
            shopName: s.shopName,
            isHeadquarters: s.isHeadquarters === 1,
            createTime: s.createTime,
        }));
        res.json({ ok: true, data: active });
    }
    catch (err) {
        next(err);
    }
});
// GET /api/erp/scales/status - Estado y telemetría de balanzas
erpPublicRouter.get('/scales/status', requireApiKey, async (_req, res, next) => {
    try {
        const raw = await termRequest('/api/termInfo/all');
        const scales = (raw ?? []).map((s) => ({
            termId: s.termId,
            termName: s.termName,
            shopId: s.shopId,
            shopCode: s.shopCode,
            ipAddress: s.ipAddress,
            onlineStatus: s.onlineStatus,
            isOnline: s.onlineStatus === 1,
            isMaster: s.isMaster === 1 || s.isMaster === true,
            version: s.version,
            lastCommunicationTime: s.lastCommunicationTime,
            lastSyncTermGoodsTime: s.lastSyncTermGoodsTime,
        }));
        res.json({ ok: true, data: scales });
    }
    catch (err) {
        next(err);
    }
});
// GET /api/erp/openapi.json - Especificación OpenAPI 3.0 descargable
erpPublicRouter.get('/openapi.json', (_req, res) => {
    const spec = {
        openapi: '3.0.3',
        info: {
            title: 'SDM-PORTAL ERP Integration API',
            version: '3.0.0',
            description: 'API REST para integración directa de sistemas POS y ERP con balanzas inteligentes SDM.',
        },
        servers: [{ url: '/api/erp', description: 'Servidor SDM Portal' }],
        components: {
            securitySchemes: {
                ApiKeyAuth: {
                    type: 'apiKey',
                    in: 'header',
                    name: 'X-Api-Key',
                    description: 'Clave API generada en el módulo de Integración ERP de SDM Portal.',
                },
            },
        },
        security: [{ ApiKeyAuth: [] }],
        paths: {
            '/products': {
                post: {
                    summary: 'Carga masiva de productos (JSON o CSV)',
                    description: 'Crea o actualiza productos por tienda en lotes de hasta 20.000 items.',
                },
                get: {
                    summary: 'Consulta productos y precios actuales',
                    parameters: [
                        { name: 'shop_code', in: 'query', required: true, schema: { type: 'string' } },
                        { name: 'goodsPlu', in: 'query', schema: { type: 'string' } },
                    ],
                },
            },
            '/products/price': {
                post: {
                    summary: 'Actualización rápida de precio unitario por PLU',
                    description: 'Actualiza el precio de un solo PLU e inmediatamente lo transmite a las balanzas si distribute: true.',
                },
            },
            '/scales': {
                get: { summary: 'Lista balanzas registradas' },
            },
            '/scales/distribute': {
                post: { summary: 'Transmite datos directamente a las balanzas (typeList: 0=PLUs, 1=Agrupación, 2=Imágenes)' },
            },
            '/shops': {
                get: { summary: 'Lista sucursales activas y sus códigos' },
            },
        },
    };
    res.json(spec);
});
// =================== Admin (JWT) ===================
export const erpAdminRouter = Router();
const adminRouter = erpAdminRouter;
adminRouter.use(requireAuth);
const CreateKeySchema = z.object({
    name: z.string().min(2).max(64),
});
adminRouter.get('/keys', (_req, res) => {
    res.json({ ok: true, data: listApiKeys() });
});
adminRouter.post('/keys', (req, res) => {
    const parsed = CreateKeySchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            ok: false,
            error: { code: 'VALIDATION', message: 'Nombre invÃƒÂ¡lido', details: parsed.error.flatten() },
        });
        return;
    }
    const created = createApiKey(parsed.data.name, req.user.sub);
    res.status(201).json({ ok: true, data: created });
});
adminRouter.patch('/keys/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
        res.status(400).json({ ok: false, error: { code: 'BAD_ID', message: 'ID invÃƒÂ¡lido' } });
        return;
    }
    const body = z.object({ enabled: z.boolean() }).safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ ok: false, error: { code: 'VALIDATION', message: 'Body invÃƒÂ¡lido' } });
        return;
    }
    const ok = setApiKeyEnabled(id, body.data.enabled);
    if (!ok) {
        res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'No existe' } });
        return;
    }
    res.json({ ok: true, data: { id, enabled: body.data.enabled } });
});
adminRouter.delete('/keys/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
        res.status(400).json({ ok: false, error: { code: 'BAD_ID', message: 'ID invÃƒÂ¡lido' } });
        return;
    }
    const ok = deleteApiKey(id);
    if (!ok) {
        res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'No existe' } });
        return;
    }
    res.json({ ok: true, data: { id, deleted: true } });
});
const recentLog = db.prepare(`
  SELECT id, api_key_id, api_key_name, source, shop_code, mode, status,
         total, created, updated, deleted, failed, duration_ms,
         client_ip, request_id, started_at, ended_at
  FROM erp_sync_log
  ORDER BY started_at DESC
  LIMIT ?
`);
const logDetail = db.prepare(`
  SELECT * FROM erp_sync_log WHERE id = ?
`);
adminRouter.get('/sync-log', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    res.json({ ok: true, data: recentLog.all(limit) });
});
adminRouter.get('/sync-log/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
        res.status(400).json({ ok: false, error: { code: 'BAD_ID', message: 'ID invÃƒÂ¡lido' } });
        return;
    }
    const row = logDetail.get(id);
    if (!row) {
        res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'No existe' } });
        return;
    }
    res.json({ ok: true, data: row });
});
//# sourceMappingURL=erp.js.map