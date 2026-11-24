import { termRequest } from './termAdmin.js';
const PAGE_SIZE = 200;
export function normalizeProductGroupName(name) {
    return name.trim().replace(/\s+/g, ' ').toLowerCase();
}
export async function listShopGoodGroups(shopId) {
    const groups = [];
    let page = 0;
    while (true) {
        const response = await termRequest('/api/shopGoodGroup', {
            query: { page, size: PAGE_SIZE, sort: 'sortNo,asc', shopId },
        });
        groups.push(...response.content);
        if (response.last || response.content.length < PAGE_SIZE)
            return groups;
        page++;
    }
}
export async function createShopGoodGroup(shopId, groupName, sortNo) {
    const groupNum = await termRequest('/api/shopGoodGroup/generateNewGroupNum', {
        query: { shopId, pId: 0 },
    });
    if (!Number.isFinite(groupNum)) {
        throw new Error(`term_admin devolvió un número de grupo inválido para "${groupName}"`);
    }
    const group = await termRequest('/api/shopGoodGroup', {
        method: 'POST',
        body: { shopId, pid: 0, groupNum, groupName, sortNo, enabled: true },
    });
    if (!Number.isFinite(group?.id)) {
        throw new Error(`term_admin no devolvió el identificador del grupo "${groupName}"`);
    }
    return group;
}
export async function listShopGoodGroupRelations(shopId, filters = {}) {
    const relations = [];
    let page = 0;
    while (true) {
        const response = await termRequest('/api/shopGoodGroupRlt', {
            query: { page, size: PAGE_SIZE, sort: 'sortNo,asc', shopId, ...filters },
        });
        relations.push(...response.content);
        if (response.last || response.content.length < PAGE_SIZE)
            return relations;
        page++;
    }
}
export async function listShopProducts(shopId) {
    const products = [];
    let page = 0;
    while (true) {
        const response = await termRequest('/api/shopGoodsInfo', {
            query: { page, size: PAGE_SIZE, shopId },
        });
        products.push(...response.content.filter((product) => product.shopId === shopId));
        if (response.last || response.content.length < PAGE_SIZE)
            return products;
        page++;
    }
}
export async function listShopProductsByGoodCodes(shopId, goodCodes) {
    const wanted = new Set(goodCodes);
    if (wanted.size === 0)
        return [];
    return (await listShopProducts(shopId)).filter((product) => typeof product.goodCode === 'string' && wanted.has(product.goodCode));
}
export async function updateShopProductDepartment(product, deptCode) {
    await termRequest('/api/shopGoodsInfo', {
        method: 'PUT',
        body: { ...product, deptCode },
    });
}
export async function createShopGoodGroupRelations(shopId, groupId, goodCodeList) {
    if (goodCodeList.length === 0)
        return;
    await termRequest('/api/shopGoodGroupRlt/createBatch', {
        method: 'POST',
        body: { shopId, groupId, subgroupId: 0, goodCodeList },
    });
}
export async function deleteShopGoodGroupRelations(shopId, groupId, subgroupId, goodCodeList) {
    if (goodCodeList.length === 0)
        return;
    await termRequest('/api/shopGoodGroupRlt/deleteBatch', {
        method: 'DELETE',
        body: { shopId, groupId, subgroupId, goodCodeList },
    });
}
//# sourceMappingURL=productGroups.js.map