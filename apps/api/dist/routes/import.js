import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { termRequest } from '../upstream/termAdmin.js';
import { logger } from '../logger.js';
import { db } from '../db/client.js';
export const importRouter = Router();
importRouter.use(requireAuth);
const ImportItemSchema = z.object({
    shopCode: z.string().min(1),
    goodsPlu: z.string().min(1),
    goodsName: z.string().min(1),
    unitName: z.string().default('KG'),
    priceModel: z.union([z.literal(0), z.literal(1)]).default(0),
    price: z.coerce.number().nonnegative().optional(),
    memberPrice: z.coerce.number().nonnegative().optional(),
    promotionPrice: z.coerce.number().nonnegative().optional(),
    itemCode: z.string().optional(),
    barCode: z.string().optional(),
    barCodeType: z.string().optional(),
    deptCode: z.string().optional(),
    brand: z.string().optional(),
    spec: z.string().optional(),
    origin: z.string().optional(),
    qualityPeriod: z.coerce.number().int().optional(),
    priceVariable: z.string().optional(),
    labelNo: z.coerce.number().int().default(0),
    imagePath: z.string().optional(),
});
const ImportPayloadSchema = z.object({
    shopCode: z.string().min(1),
    mode: z.enum(['full', 'incremental']).default('incremental'),
    items: z.array(ImportItemSchema).min(1).max(20000),
});
const CONCURRENCY = 4;
async function lookupShopId(shopCode) {
    const shops = await termRequest('/api/shopInfo/all');
    const active = shops.filter((s) => {
        const ext = s;
        return ext.deleteFlag !== 1 && ext.shopStatus !== false;
    });
    return active.find((s) => s.shopCode === shopCode)?.shopId ?? null;
}
async function listExistingPlus(shopId) {
    const existingPlus = new Set();
    const PAGE_SIZE = 200;
    let page = 0;
    while (true) {
        const res = await termRequest('/api/shopGoodsInfo', {
            query: { page, size: PAGE_SIZE, shopId },
        });
        for (const p of res.content) {
            if (p.shopId === shopId && p.goodsPlu) {
                existingPlus.add(String(p.goodsPlu).trim());
            }
        }
        if (res.last || res.content.length < PAGE_SIZE)
            break;
        page++;
    }
    return existingPlus;
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
importRouter.post('/import/products', async (req, res, next) => {
    try {
        const parsed = ImportPayloadSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({
                ok: false,
                error: {
                    code: 'VALIDATION',
                    message: 'Datos de import inválidos',
                    details: parsed.error.flatten(),
                },
            });
            return;
        }
        const { shopCode, mode, items } = parsed.data;
        const shopId = await lookupShopId(shopCode);
        if (shopId === null) {
            res.status(400).json({
                ok: false,
                error: { code: 'BAD_SHOP', message: `Tienda no encontrada o inactiva: ${shopCode}` },
            });
            return;
        }
        // 1. Deduplicar PLUs repetidos dentro del propio lote cargado
        const seenInFile = new Set();
        const uniqueItems = [];
        let skippedDuplicate = 0;
        items.forEach((it, idx) => {
            const normalizedPlu = it.goodsPlu.trim();
            if (seenInFile.has(normalizedPlu)) {
                skippedDuplicate++;
                return;
            }
            seenInFile.add(normalizedPlu);
            uniqueItems.push({ item: { ...it, goodsPlu: normalizedPlu }, originalRow: idx + 1 });
        });
        // 2. Consultar PLUs existentes en la tienda y filtrar solo los realmente nuevos
        const existingPlus = await listExistingPlus(shopId);
        const newItems = [];
        let skippedExisting = 0;
        for (const entry of uniqueItems) {
            if (existingPlus.has(entry.item.goodsPlu)) {
                skippedExisting++;
            }
            else {
                newItems.push(entry);
            }
        }
        let created = 0;
        const updated = 0;
        let failed = 0;
        const errors = [];
        // 3. Crear únicamente productos nuevos en term_admin (sin actualizar precios existentes)
        await runWithConcurrency(newItems, CONCURRENCY, async ({ item: it, originalRow }) => {
            const targetShopCode = it.shopCode || shopCode;
            const base = {
                shopCode: targetShopCode,
                shopId,
                goodsPlu: it.goodsPlu,
                itemCode: it.itemCode?.trim() || it.goodsPlu,
                goodsName: it.goodsName.trim(),
                unitName: it.unitName,
                priceModel: it.priceModel,
                price: it.price ?? 0,
                memberPrice: it.memberPrice ?? null,
                promotionPrice: it.promotionPrice ?? null,
                barCode: it.barCode ?? '',
                barCodeType: it.barCodeType ?? '',
                deptCode: it.deptCode ?? '',
                brand: it.brand ?? '',
                spec: it.spec ?? '',
                origin: it.origin ?? '',
                qualityPeriod: it.qualityPeriod ?? null,
                priceVariable: it.priceVariable ?? '0',
                labelNo: it.labelNo,
                imagePath: it.imagePath ?? '',
                downTermEnabled: 1,
            };
            try {
                await termRequest('/api/shopGoodsInfo', { method: 'POST', body: base });
                created++;
            }
            catch (e) {
                failed++;
                const msg = e instanceof Error ? e.message : String(e);
                errors.push({ row: originalRow, plu: it.goodsPlu, error: msg });
                logger.warn({ row: originalRow, plu: it.goodsPlu, error: msg }, 'New item import failed');
            }
        });
        db.prepare("INSERT INTO audit_log (user_id, action, target, ip, payload) VALUES (?, 'IMPORT_PRODUCTS', ?, ?, ?)").run(req.user.sub, shopCode, req.ip ?? null, JSON.stringify({ mode, total: items.length, created, updated, skippedExisting, skippedDuplicate, failed }));
        res.json({
            ok: true,
            data: {
                mode,
                total: items.length,
                created,
                updated,
                deleted: 0,
                skippedExisting,
                skippedDuplicate,
                failed,
                success: created,
                errors,
            },
        });
    }
    catch (err) {
        next(err);
    }
});
//# sourceMappingURL=import.js.map