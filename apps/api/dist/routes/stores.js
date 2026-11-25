import { Router } from 'express';
import { requireAdmin, requireAuth } from '../auth/middleware.js';
import { termRequest, UpstreamError } from '../upstream/termAdmin.js';
import { upsertShops } from '../db/mirror.js';
import { db } from '../db/client.js';
import { getSetting, setSetting } from '../db/settings.js';
export const storesRouter = Router();
storesRouter.use(requireAuth);
async function syncShopsMirror() {
    const rawLive = await termRequest('/api/shopInfo/all');
    const live = rawLive
        .filter((s) => s.deleteFlag !== 1)
        .map((s) => {
        const localPhone = getSetting(`shop.${s.shopId}.phone`);
        return localPhone !== null ? { ...s, directorPhone: localPhone } : s;
    });
    upsertShops(live);
    return live;
}
function cleanShopPayload(base, updates) {
    const merged = { ...base, ...updates };
    // Eliminar campos virtuales/calculados que no pertenecen a la entidad shopInfo
    delete merged.deptName;
    delete merged.marketName;
    delete merged.directorName;
    delete merged.directorPhone;
    delete merged.termNum;
    delete merged.devNum;
    delete merged.goodsNum;
    delete merged.onlineDevNum;
    delete merged.onlineTagNum;
    delete merged.customLogoURL;
    if (typeof merged.logoURL === 'string' && merged.logoURL.endsWith('null')) {
        merged.logoURL = 'null';
    }
    return merged;
}
storesRouter.get('/stores/meta', async (_req, res, next) => {
    try {
        const [deptsRes, usersRes] = await Promise.allSettled([
            termRequest('/api/dept?page=0&size=200'),
            termRequest('/api/user?page=0&size=200'),
        ]);
        const extractList = (r) => {
            if (r.status !== 'fulfilled' || !r.value)
                return [];
            const val = r.value;
            if (Array.isArray(val))
                return val;
            if (Array.isArray(val.content))
                return val.content;
            return [];
        };
        const depts = extractList(deptsRes)
            .map((d) => ({
            id: Number(d.id ?? d.deptId ?? 0),
            name: String(d.name ?? d.deptName ?? ''),
        }))
            .filter((d) => d.id > 0 && d.name);
        const users = extractList(usersRes)
            .map((u) => ({
            id: Number(u.id ?? u.userId ?? 0),
            name: String(u.nickName ?? u.username ?? u.name ?? ''),
            phone: String(u.phone ?? ''),
        }))
            .filter((u) => u.id > 0 && u.name);
        res.json({ ok: true, data: { depts, users } });
    }
    catch (err) {
        next(err);
    }
});
// --- TIENDAS (shopInfo) ---
storesRouter.post('/shops', requireAdmin, async (req, res, next) => {
    try {
        const body = req.body;
        const payload = {
            shopCode: String(body.shopCode ?? '').trim(),
            shopName: String(body.shopName ?? '').trim(),
            deptId: body.deptId ? Number(body.deptId) : 2,
            areaDetail: String(body.areaDetail ?? '').trim(),
            marketId: body.marketId ? Number(body.marketId) : 1,
            directorId: body.directorId ? Number(body.directorId) : 1,
            openTime: String(body.openTime ?? '08:00:00'),
            closeTime: String(body.closeTime ?? '20:00:00'),
            unit: String(body.unit ?? 'kg'),
            tagDisplayAttribute: String(body.tagDisplayAttribute ?? 'plu'),
            shopStatus: body.shopStatus !== undefined ? Boolean(body.shopStatus) : true,
            isHeadquarters: body.isHeadquarters !== undefined ? Number(body.isHeadquarters) : 0,
            isCloud: 0,
            deleteFlag: 0,
            priceWarn: 1,
            logoEnable: 0,
            volume: 0,
        };
        const upstream = await termRequest('/api/shopInfo', {
            method: 'POST',
            body: payload,
        });
        const live = await syncShopsMirror();
        res.json({ ok: true, data: { upstream, shops: live } });
    }
    catch (err) {
        next(err);
    }
});
storesRouter.put('/shops/:id', requireAdmin, async (req, res, next) => {
    try {
        const shopId = Number(req.params.id);
        const allShops = await termRequest('/api/shopInfo/all');
        const existing = allShops.find((s) => Number(s.shopId) === shopId);
        if (!existing) {
            throw new UpstreamError('Tienda no encontrada en term_admin', 404, 'SHOP_NOT_FOUND');
        }
        const body = req.body;
        const updates = {
            shopId,
            shopCode: body.shopCode !== undefined ? String(body.shopCode).trim() : existing.shopCode,
            shopName: body.shopName !== undefined ? String(body.shopName).trim() : existing.shopName,
            areaDetail: body.areaDetail !== undefined ? String(body.areaDetail).trim() : existing.areaDetail,
            deptId: body.deptId !== undefined && body.deptId !== '' ? Number(body.deptId) : existing.deptId,
            marketId: body.marketId !== undefined && body.marketId !== ''
                ? Number(body.marketId)
                : existing.marketId,
            directorId: body.directorId !== undefined && body.directorId !== ''
                ? Number(body.directorId)
                : existing.directorId,
            openTime: body.openTime !== undefined ? String(body.openTime) : existing.openTime,
            closeTime: body.closeTime !== undefined ? String(body.closeTime) : existing.closeTime,
            shopStatus: body.shopStatus !== undefined ? Boolean(body.shopStatus) : existing.shopStatus,
        };
        const payload = cleanShopPayload(existing, updates);
        const upstream = await termRequest('/api/shopInfo', {
            method: 'PUT',
            body: payload,
        });
        // Si cambi? el tel?fono o nombre del encargado, actualizar tambi?n el usuario encargado en term_admin
        const directorId = Number(payload.directorId ?? 0);
        if (directorId > 0 && (body.directorPhone !== undefined || body.directorName !== undefined)) {
            try {
                const usersRaw = await termRequest('/api/user?page=0&size=200');
                const userList = Array.isArray(usersRaw) ? usersRaw : (usersRaw.content ?? []);
                const targetUser = userList.find((u) => Number(u.id ?? u.userId) === directorId);
                if (targetUser) {
                    const updatedUser = {
                        ...targetUser,
                        ...(body.directorPhone !== undefined ? { phone: String(body.directorPhone).trim() } : {}),
                        ...(body.directorName !== undefined && String(body.directorName).trim()
                            ? { nickName: String(body.directorName).trim() }
                            : {}),
                    };
                    await termRequest('/api/user', {
                        method: 'PUT',
                        body: updatedUser,
                    });
                }
            }
            catch {
                // No bloquear el guardado de tienda si el usuario no es editable
            }
        }
        if (body.directorPhone !== undefined) {
            setSetting(`shop.${shopId}.phone`, String(body.directorPhone).trim());
        }
        const live = await syncShopsMirror();
        res.json({ ok: true, data: { upstream, shops: live } });
    }
    catch (err) {
        next(err);
    }
});
storesRouter.delete('/shops', requireAdmin, async (req, res, next) => {
    try {
        const ids = Array.isArray(req.body?.shopIds) ? req.body.shopIds.map(Number) : [];
        const upstream = await termRequest('/api/shopInfo', {
            method: 'DELETE',
            body: ids,
        });
        for (const id of ids) {
            db.prepare('DELETE FROM mirror_shops WHERE shop_id = ?').run(id);
        }
        const live = await syncShopsMirror();
        res.json({ ok: true, data: { upstream, shops: live } });
    }
    catch (err) {
        next(err);
    }
});
// --- MARCAS (solo lectura para el selector de tienda) ---
storesRouter.get('/brands', async (_req, res, next) => {
    try {
        const raw = await termRequest('/api/market?page=0&size=200');
        const list = Array.isArray(raw) ? raw : (raw.content ?? []);
        const active = list.filter((m) => m.deleteFlag !== 1);
        res.json({ ok: true, data: active });
    }
    catch (err) {
        next(err);
    }
});
//# sourceMappingURL=stores.js.map