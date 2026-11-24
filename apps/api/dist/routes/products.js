import { z } from 'zod';
import { Router } from 'express';
import { BulkPriceUpdateSchema, PriceUpdateSchema, ProductFiltersSchema, } from '@sdm/shared';
import { requireAuth } from '../auth/middleware.js';
import { termRequest } from '../upstream/termAdmin.js';
import { createShopGoodGroupRelations, deleteShopGoodGroupRelations, listShopGoodGroupRelations, listShopGoodGroups, } from '../upstream/productGroups.js';
export const productsRouter = Router();
productsRouter.use(requireAuth);
productsRouter.get('/products', async (req, res, next) => {
    try {
        const parsed = ProductFiltersSchema.safeParse(req.query);
        if (!parsed.success) {
            res.status(400).json({
                ok: false,
                error: {
                    code: 'VALIDATION',
                    message: 'Filtros invÃƒÂ¡lidos',
                    details: parsed.error.flatten(),
                },
            });
            return;
        }
        const filters = parsed.data;
        const query = {
            page: filters.page,
            size: filters.size,
        };
        if (filters.goodsName)
            query.goodsName = filters.goodsName;
        if (filters.goodsPlu)
            query.goodsPlu = filters.goodsPlu;
        if (filters.shopId !== undefined)
            query.shopId = filters.shopId;
        if (filters.priceModel !== undefined)
            query.priceModel = filters.priceModel;
        if (filters.deptCode)
            query.deptCode = filters.deptCode;
        query.sort = 'goodsPlu,asc';
        const data = await termRequest('/api/shopGoodsInfo', { query });
        if (Array.isArray(data.content)) {
            data.content.sort((a, b) => {
                const na = Number(a.goodsPlu);
                const nb = Number(b.goodsPlu);
                if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb)
                    return na - nb;
                return String(a.goodsPlu ?? '').localeCompare(String(b.goodsPlu ?? ''), undefined, {
                    numeric: true,
                });
            });
        }
        res.json({ ok: true, data });
    }
    catch (err) {
        next(err);
    }
});
productsRouter.get('/products/:id', async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            res
                .status(400)
                .json({ ok: false, error: { code: 'BAD_ID', message: 'id invÃƒÂ¡lido' } });
            return;
        }
        const data = await termRequest('/api/shopGoodsInfo', {
            query: { page: 0, size: 1, shopGoodId: id },
        });
        const item = data.content.find((p) => p.shopGoodId === id) ?? data.content[0];
        if (!item) {
            res
                .status(404)
                .json({ ok: false, error: { code: 'NOT_FOUND', message: 'Producto no encontrado' } });
            return;
        }
        res.json({ ok: true, data: item });
    }
    catch (err) {
        next(err);
    }
});
productsRouter.post('/products/price', async (req, res, next) => {
    try {
        const parsed = PriceUpdateSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({
                ok: false,
                error: { code: 'VALIDATION', message: 'Datos invÃƒÂ¡lidos', details: parsed.error.flatten() },
            });
            return;
        }
        // El backend BLS espera el objeto producto completo para modifyProductPrice;
        // primero obtenemos el actual, luego aplicamos el cambio y reenviamos.
        const current = await termRequest('/api/shopGoodsInfo', {
            query: { page: 0, size: 1, shopGoodId: parsed.data.shopGoodId },
        });
        const product = current.content.find((p) => p.shopGoodId === parsed.data.shopGoodId);
        if (!product) {
            res
                .status(404)
                .json({ ok: false, error: { code: 'NOT_FOUND', message: 'Producto no encontrado' } });
            return;
        }
        const updated = {
            ...product,
            price: parsed.data.price ?? product.price,
            memberPrice: parsed.data.memberPrice !== undefined ? parsed.data.memberPrice : product.memberPrice,
            promotionPrice: parsed.data.promotionPrice !== undefined
                ? parsed.data.promotionPrice
                : product.promotionPrice,
        };
        await termRequest('/api/shopGoodsInfo/modifyProductPrice', {
            method: 'POST',
            body: updated,
        });
        res.json({ ok: true, data: { shopGoodId: parsed.data.shopGoodId } });
    }
    catch (err) {
        next(err);
    }
});
productsRouter.post('/products/bulk-price', async (req, res, next) => {
    try {
        const parsed = BulkPriceUpdateSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({
                ok: false,
                error: {
                    code: 'VALIDATION',
                    message: 'Datos invÃƒÂ¡lidos',
                    details: parsed.error.flatten(),
                },
            });
            return;
        }
        const { shopGoodIds, mode, value, field } = parsed.data;
        // Fetch en lotes de 100 para evitar OOM y respetar paginaciÃƒÂ³n
        const products = [];
        const PAGE_SIZE = 100;
        for (let i = 0; i < shopGoodIds.length; i += PAGE_SIZE) {
            const slice = shopGoodIds.slice(i, i + PAGE_SIZE);
            const page = await termRequest('/api/shopGoodsInfo', {
                query: { page: 0, size: PAGE_SIZE, shopGoodIdList: slice.join(',') },
            });
            products.push(...page.content.filter((p) => slice.includes(p.shopGoodId)));
        }
        let success = 0;
        let failed = 0;
        const errors = [];
        for (const p of products) {
            const oldVal = p[field] ?? 0;
            let newVal;
            switch (mode) {
                case 'percent':
                    newVal = Number((oldVal * (1 + value / 100)).toFixed(2));
                    break;
                case 'fixed':
                    newVal = Number((oldVal + value).toFixed(2));
                    break;
                case 'set':
                    newVal = Number(value.toFixed(2));
                    break;
            }
            if (newVal < 0)
                newVal = 0;
            try {
                await termRequest('/api/shopGoodsInfo/modifyProductPrice', {
                    method: 'POST',
                    body: { ...p, [field]: newVal },
                });
                success++;
            }
            catch (e) {
                failed++;
                errors.push({
                    shopGoodId: p.shopGoodId,
                    error: e instanceof Error ? e.message : String(e),
                });
            }
        }
        res.json({
            ok: true,
            data: { requested: shopGoodIds.length, found: products.length, success, failed, errors },
        });
    }
    catch (err) {
        next(err);
    }
});
const ProductFullUpdateSchema = z.object({
    goodsPlu: z.string().min(1).max(32).optional(),
    goodsName: z.string().min(1).max(120).optional(),
    itemCode: z.string().max(64).nullable().optional(),
    priceModel: z.number().int().min(0).max(1).optional(),
    unitName: z.string().max(16).nullable().optional(),
    deptCode: z.string().max(32).nullable().optional(),
    groupId: z.number().int().positive().nullable().optional(),
    price: z.number().min(0).optional(),
    memberPrice: z.number().min(0).nullable().optional(),
    promotionPrice: z.number().min(0).nullable().optional(),
});
const DeleteProductsSchema = z.object({
    shopGoodIds: z.array(z.number().int().positive()).min(1).max(500),
});
const BulkDepartmentSchema = z.object({
    shopGoodIds: z.array(z.number().int().positive()).min(1).max(2000),
    groupId: z.number().int().positive().nullable(),
    shopId: z.number().int().positive().optional(),
}).superRefine((data, context) => {
    if (data.groupId !== null && data.shopId === undefined) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['shopId'],
            message: 'shopId es obligatorio al asignar un departamento',
        });
    }
});
async function syncDepartmentGroupLinks(products, groupTargets) {
    const errors = [];
    const productsByShop = new Map();
    for (const product of products) {
        const bucket = productsByShop.get(product.shopId) ?? [];
        bucket.push(product);
        productsByShop.set(product.shopId, bucket);
    }
    for (const [shopId, shopProducts] of productsByShop) {
        const productsByCode = new Map();
        for (const product of shopProducts) {
            if (!product.goodCode) {
                errors.push({
                    shopGoodId: product.shopGoodId,
                    goodsPlu: product.goodsPlu,
                    error: 'El producto no tiene goodCode; no se pudo sincronizar su grupo',
                });
                continue;
            }
            const matches = productsByCode.get(product.goodCode) ?? [];
            matches.push(product);
            productsByCode.set(product.goodCode, matches);
        }
        if (productsByCode.size === 0)
            continue;
        const groups = await listShopGoodGroups(shopId);
        const rootGroups = groups.filter((group) => group.pid === 0);
        const rootGroupIds = new Set(rootGroups.map((group) => group.id));
        const targetGroup = groupTargets.get(shopId) ?? null;
        const relations = await listShopGoodGroupRelations(shopId);
        const productCodes = new Set(productsByCode.keys());
        const blockedCodes = new Set();
        if (targetGroup) {
            try {
                await createShopGoodGroupRelations(shopId, targetGroup.id, [...productCodes]);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                for (const product of shopProducts) {
                    if (product.goodCode && productCodes.has(product.goodCode)) {
                        errors.push({
                            shopGoodId: product.shopGoodId,
                            goodsPlu: product.goodsPlu,
                            error: `No se pudo vincular al grupo: ${message}`,
                        });
                        blockedCodes.add(product.goodCode);
                    }
                }
            }
        }
        const codesToRemove = new Map();
        for (const relation of relations) {
            if (!rootGroupIds.has(relation.groupId) ||
                !productCodes.has(relation.goodCode) ||
                blockedCodes.has(relation.goodCode) ||
                relation.groupId === targetGroup?.id) {
                continue;
            }
            const subgroupCodes = codesToRemove.get(relation.groupId) ?? new Map();
            const groupCodes = subgroupCodes.get(relation.subgroupId) ?? new Set();
            groupCodes.add(relation.goodCode);
            subgroupCodes.set(relation.subgroupId, groupCodes);
            codesToRemove.set(relation.groupId, subgroupCodes);
        }
        for (const [groupId, subgroupCodes] of codesToRemove) {
            for (const [subgroupId, codes] of subgroupCodes) {
                const goodCodeList = [...codes];
                try {
                    await deleteShopGoodGroupRelations(shopId, groupId, subgroupId, goodCodeList);
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    for (const code of goodCodeList) {
                        for (const product of productsByCode.get(code) ?? []) {
                            errors.push({
                                shopGoodId: product.shopGoodId,
                                goodsPlu: product.goodsPlu,
                                error: `No se pudo quitar el vínculo anterior: ${message}`,
                            });
                        }
                    }
                }
            }
        }
    }
    return errors;
}
productsRouter.put('/products/:id', async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            res.status(400).json({ ok: false, error: { code: 'BAD_ID', message: 'id inválido' } });
            return;
        }
        const parsed = ProductFullUpdateSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({
                ok: false,
                error: { code: 'VALIDATION', message: 'Datos inválidos', details: parsed.error.flatten() },
            });
            return;
        }
        const current = await termRequest('/api/shopGoodsInfo', {
            query: { page: 0, size: 1, shopGoodId: id },
        });
        const product = current.content.find((p) => p.shopGoodId === id);
        if (!product) {
            res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Producto no encontrado' } });
            return;
        }
        const d = parsed.data;
        const updated = {
            ...product,
            shopGoodId: id,
        };
        if (d.goodsPlu !== undefined)
            updated.goodsPlu = d.goodsPlu.trim();
        if (d.goodsName !== undefined)
            updated.goodsName = d.goodsName.trim();
        if (d.itemCode !== undefined)
            updated.itemCode = d.itemCode ? d.itemCode.trim() : null;
        if (d.priceModel !== undefined)
            updated.priceModel = d.priceModel;
        if (d.unitName !== undefined)
            updated.unitName = d.unitName ? d.unitName.trim() : null;
        let targetGroup = null;
        if (d.groupId !== undefined) {
            if (d.groupId !== null) {
                const groups = await listShopGoodGroups(product.shopId);
                targetGroup = groups.find((group) => group.id === d.groupId && group.pid === 0) ?? null;
                if (!targetGroup) {
                    res.status(400).json({
                        ok: false,
                        error: { code: 'BAD_GROUP', message: 'El grupo seleccionado no pertenece a esta tienda' },
                    });
                    return;
                }
            }
            updated.deptCode = targetGroup?.groupName ?? null;
        }
        else if (d.deptCode !== undefined) {
            updated.deptCode = d.deptCode ? d.deptCode.trim() : null;
        }
        if (d.price !== undefined)
            updated.price = d.price;
        if (d.memberPrice !== undefined)
            updated.memberPrice = d.memberPrice;
        if (d.promotionPrice !== undefined)
            updated.promotionPrice = d.promotionPrice;
        await termRequest('/api/shopGoodsInfo', {
            method: 'PUT',
            body: updated,
        });
        if (d.groupId !== undefined) {
            const linkErrors = await syncDepartmentGroupLinks([product], new Map([[product.shopId, targetGroup]]));
            if (linkErrors.length > 0) {
                res.status(502).json({
                    ok: false,
                    error: {
                        code: 'GROUP_SYNC',
                        message: linkErrors.map((failure) => `${failure.goodsPlu}: ${failure.error}`).join('; '),
                    },
                });
                return;
            }
        }
        res.json({ ok: true, data: { shopGoodId: id } });
    }
    catch (err) {
        next(err);
    }
});
productsRouter.post('/products/bulk-department', async (req, res, next) => {
    try {
        const parsed = BulkDepartmentSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({
                ok: false,
                error: {
                    code: 'VALIDATION',
                    message: 'Datos de departamento inválidos',
                    details: parsed.error.flatten(),
                },
            });
            return;
        }
        const { shopGoodIds, groupId, shopId: targetShopId } = parsed.data;
        if (groupId !== null && targetShopId === undefined) {
            res.status(400).json({
                ok: false,
                error: { code: 'BAD_SHOP', message: 'Debes seleccionar la tienda del departamento' },
            });
            return;
        }
        const products = [];
        for (let i = 0; i < shopGoodIds.length; i += 100) {
            const chunk = shopGoodIds.slice(i, i + 100);
            const page = await termRequest('/api/shopGoodsInfo', {
                query: { page: 0, size: 100, shopGoodIdList: chunk.join(',') },
            });
            products.push(...page.content.filter((product) => chunk.includes(product.shopGoodId)));
        }
        const errors = [];
        const foundIds = new Set(products.map((product) => product.shopGoodId));
        for (const shopGoodId of shopGoodIds) {
            if (!foundIds.has(shopGoodId)) {
                errors.push({ shopGoodId, goodsPlu: '', error: 'Producto no encontrado' });
            }
        }
        let selectedGroup = null;
        if (groupId !== null && targetShopId !== undefined) {
            const groups = await listShopGoodGroups(targetShopId);
            selectedGroup = groups.find((group) => group.id === groupId && group.pid === 0) ?? null;
            if (!selectedGroup) {
                res.status(400).json({
                    ok: false,
                    error: { code: 'BAD_GROUP', message: 'Grupo no encontrado o no es un grupo de departamento' },
                });
                return;
            }
        }
        const targets = new Map();
        for (const product of products) {
            if (groupId !== null && product.shopId !== selectedGroup?.shopId) {
                errors.push({
                    shopGoodId: product.shopGoodId,
                    goodsPlu: product.goodsPlu,
                    error: 'El grupo seleccionado pertenece a otra tienda',
                });
                continue;
            }
            targets.set(product.shopId, selectedGroup);
        }
        const eligibleProducts = products.filter((product) => groupId === null || product.shopId === selectedGroup?.shopId);
        let cursor = 0;
        const productUpdateErrors = [];
        const updatedProducts = [];
        const workers = Array.from({ length: Math.min(4, eligibleProducts.length) }, async () => {
            while (cursor < eligibleProducts.length) {
                const product = eligibleProducts[cursor++];
                if (!product)
                    continue;
                try {
                    await termRequest('/api/shopGoodsInfo', {
                        method: 'PUT',
                        body: { ...product, deptCode: targets.get(product.shopId)?.groupName ?? null },
                    });
                    updatedProducts.push(product);
                }
                catch (error) {
                    productUpdateErrors.push({
                        shopGoodId: product.shopGoodId,
                        goodsPlu: product.goodsPlu,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
        });
        await Promise.all(workers);
        errors.push(...productUpdateErrors);
        const linkErrors = await syncDepartmentGroupLinks(updatedProducts, targets);
        errors.push(...linkErrors);
        const failedIds = new Set(errors.map((failure) => failure.shopGoodId));
        res.json({
            ok: true,
            data: {
                requested: shopGoodIds.length,
                found: products.length,
                updated: products.filter((product) => !failedIds.has(product.shopGoodId)).length,
                failed: failedIds.size,
                errors,
            },
        });
    }
    catch (err) {
        next(err);
    }
});
productsRouter.delete('/products', async (req, res, next) => {
    try {
        const parsed = DeleteProductsSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({
                ok: false,
                error: { code: 'VALIDATION', message: 'Lista de IDs inválida', details: parsed.error.flatten() },
            });
            return;
        }
        const ids = parsed.data.shopGoodIds;
        const BATCH = 100;
        for (let i = 0; i < ids.length; i += BATCH) {
            const chunk = ids.slice(i, i + BATCH);
            await termRequest('/api/shopGoodsInfo', {
                method: 'DELETE',
                body: chunk,
            });
        }
        res.json({ ok: true, data: { deleted: ids.length } });
    }
    catch (err) {
        next(err);
    }
});
//# sourceMappingURL=products.js.map