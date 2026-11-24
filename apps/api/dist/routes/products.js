import { z } from 'zod';
import { Router } from 'express';
import { BulkPriceUpdateSchema, PriceUpdateSchema, ProductFiltersSchema, } from '@sdm/shared';
import { requireAuth } from '../auth/middleware.js';
import { termRequest } from '../upstream/termAdmin.js';
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
                query: { page: 0, size: PAGE_SIZE, shopGoodId: slice.join(',') },
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
    price: z.number().min(0).optional(),
    memberPrice: z.number().min(0).nullable().optional(),
    promotionPrice: z.number().min(0).nullable().optional(),
});
const DeleteProductsSchema = z.object({
    shopGoodIds: z.array(z.number().int().positive()).min(1).max(500),
});
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
        if (d.deptCode !== undefined)
            updated.deptCode = d.deptCode ? d.deptCode.trim() : null;
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
        res.json({ ok: true, data: { shopGoodId: id } });
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