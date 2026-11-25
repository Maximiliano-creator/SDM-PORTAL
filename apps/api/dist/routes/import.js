import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { termRequest } from '../upstream/termAdmin.js';
import { logger } from '../logger.js';
import { db } from '../db/client.js';
import { createShopGoodGroup, listShopGoodGroups, listShopProducts, normalizeProductGroupName, } from '../upstream/productGroups.js';
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
    items: z.array(ImportItemSchema).min(1).max(1000),
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
        if (mode === 'full' && req.user?.role !== 'admin') {
            res.status(403).json({
                ok: false,
                error: { code: 'FORBIDDEN', message: 'Solo admin puede ejecutar una importación completa.' },
            });
            return;
        }
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
        const existingProducts = new Map((await listShopProducts(shopId))
            .filter((product) => product.goodsPlu)
            .map((product) => [String(product.goodsPlu).trim(), product]));
        const newItems = [];
        let skippedExisting = 0;
        for (const entry of uniqueItems) {
            if (existingProducts.has(entry.item.goodsPlu)) {
                skippedExisting++;
            }
            else {
                newItems.push(entry);
            }
        }
        const departments = new Map();
        for (const entry of uniqueItems) {
            const name = entry.item.deptCode?.trim().replace(/\s+/g, ' ');
            if (!name)
                continue;
            const key = normalizeProductGroupName(name);
            const department = departments.get(key) ?? { name, rows: [] };
            department.rows.push(entry);
            departments.set(key, department);
        }
        const groupsByDepartment = new Map();
        let rootGroupCount = 0;
        let groupsCreated = 0;
        if (departments.size > 0) {
            const groups = await listShopGoodGroups(shopId);
            for (const group of groups) {
                if (group.pid !== 0)
                    continue;
                rootGroupCount++;
                const key = normalizeProductGroupName(group.groupName);
                if (!groupsByDepartment.has(key))
                    groupsByDepartment.set(key, group);
            }
        }
        let created = 0;
        const updated = 0;
        let failed = 0;
        const errors = [];
        const createdGoodCodes = new Map();
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
                const product = await termRequest('/api/shopGoodsInfo', {
                    method: 'POST',
                    body: base,
                });
                if (typeof product?.goodCode === 'string' && product.goodCode.trim()) {
                    createdGoodCodes.set(it.goodsPlu, product.goodCode.trim());
                }
                created++;
            }
            catch (e) {
                failed++;
                const msg = e instanceof Error ? e.message : String(e);
                errors.push({ row: originalRow, plu: it.goodsPlu, error: msg });
                logger.warn({ row: originalRow, plu: it.goodsPlu, error: msg }, 'New item import failed');
            }
        });
        const groupingErrors = [];
        let groupingFailed = 0;
        let associated = 0;
        for (const [key, department] of departments) {
            const eligibleRows = department.rows.filter(({ item }) => existingProducts.has(item.goodsPlu) || createdGoodCodes.has(item.goodsPlu));
            if (eligibleRows.length === 0)
                continue;
            let group = groupsByDepartment.get(key);
            if (!group) {
                try {
                    group = await createShopGoodGroup(shopId, department.name, rootGroupCount + groupsCreated);
                    groupsByDepartment.set(key, group);
                    groupsCreated++;
                }
                catch (e) {
                    const message = e instanceof Error ? e.message : String(e);
                    groupingFailed += eligibleRows.length;
                    groupingErrors.push({
                        department: department.name,
                        pluCount: eligibleRows.length,
                        error: message,
                    });
                    logger.warn({ shopId, department: department.name, error: message }, 'Department group creation failed');
                    continue;
                }
            }
            const goodCodeList = new Set();
            for (const { item } of eligibleRows) {
                const goodCode = existingProducts.get(item.goodsPlu)?.goodCode ?? createdGoodCodes.get(item.goodsPlu);
                if (typeof goodCode !== 'string' || !goodCode.trim()) {
                    groupingFailed++;
                    groupingErrors.push({
                        department: department.name,
                        plu: item.goodsPlu,
                        error: 'term_admin no devolvió goodCode; no se pudo asociar el PLU al grupo',
                    });
                    continue;
                }
                goodCodeList.add(goodCode.trim());
            }
            if (goodCodeList.size === 0)
                continue;
            try {
                await termRequest('/api/shopGoodGroupRlt/createBatch', {
                    method: 'POST',
                    body: {
                        shopId,
                        groupId: group.id,
                        subgroupId: 0,
                        goodCodeList: [...goodCodeList],
                    },
                });
                associated += goodCodeList.size;
            }
            catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                groupingFailed += goodCodeList.size;
                groupingErrors.push({
                    department: department.name,
                    pluCount: goodCodeList.size,
                    error: message,
                });
                logger.warn({ shopId, department: department.name, pluCount: goodCodeList.size, error: message }, 'Department group association failed');
            }
        }
        db.prepare("INSERT INTO audit_log (user_id, action, target, ip, payload) VALUES (?, 'IMPORT_PRODUCTS', ?, ?, ?)").run(req.user.sub, shopCode, req.ip ?? null, JSON.stringify({
            mode,
            total: items.length,
            created,
            updated,
            skippedExisting,
            skippedDuplicate,
            failed,
            groupsCreated,
            associated,
            groupingFailed,
        }));
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
                grouping: {
                    groupsCreated,
                    associated,
                    failed: groupingFailed,
                    errors: groupingErrors,
                },
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