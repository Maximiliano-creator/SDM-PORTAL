import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { termRequestMock } = vi.hoisted(() => ({
    termRequestMock: vi.fn(),
}));
vi.mock('../auth/middleware.js', () => ({
    requireAuth: (req, _res, next) => {
        Object.assign(req, { user: { sub: 1 } });
        next();
    },
}));
vi.mock('../upstream/termAdmin.js', () => ({
    termRequest: (...args) => termRequestMock(...args),
}));
vi.mock('../logger.js', () => ({
    logger: { warn: vi.fn(), info: vi.fn() },
}));
import { productGroupsRouter } from './productGroups.js';
let server;
let baseUrl;
let groupName;
let productDepartment;
let deletedGroupIds;
let includeChild;
const product = {
    shopGoodId: 31,
    shopId: 3,
    shopCode: 'S1',
    goodsPlu: '100',
    goodsName: 'Agua',
    goodCode: 'GOOD-100',
    deptCode: 'Bebidas',
};
beforeEach(async () => {
    groupName = 'Bebidas';
    productDepartment = 'Bebidas';
    deletedGroupIds = [];
    includeChild = false;
    termRequestMock.mockReset();
    termRequestMock.mockImplementation(async (path, options) => {
        if (path === '/api/shopGoodGroup' && !options?.method) {
            return {
                content: [
                    { id: 11, shopId: 3, pid: 0, groupNum: 5, groupName, sortNo: 0, enabled: true },
                    ...(includeChild
                        ? [{ id: 12, shopId: 3, pid: 11, groupNum: 1, groupName: 'Subgrupo' }]
                        : []),
                ],
                last: true,
            };
        }
        if (path === '/api/shopGoodGroupRlt') {
            return {
                content: [{ relatedId: 1, shopId: 3, goodCode: 'GOOD-100', groupId: 11, subgroupId: 0 }],
                last: true,
            };
        }
        if (path === '/api/shopGoodsInfo' && !options?.method) {
            return { content: [{ ...product, deptCode: productDepartment }], last: true };
        }
        if (path === '/api/shopGoodGroup' && options?.method === 'PUT') {
            groupName = options.body.groupName;
            return undefined;
        }
        if (path === '/api/shopGoodsInfo' && options?.method === 'PUT') {
            productDepartment = options.body.deptCode;
            return undefined;
        }
        if (path === '/api/shopGoodGroup' && options?.method === 'DELETE') {
            deletedGroupIds = options.body;
            return undefined;
        }
        throw new Error(`Llamada upstream inesperada: ${path}`);
    });
    const app = express();
    app.use(express.json());
    app.use('/api', productGroupsRouter);
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
    await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    });
});
describe('product group administration', () => {
    it('renames a group and synchronizes linked product departments', async () => {
        const response = await fetch(`${baseUrl}/api/product-groups/11`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ shopId: 3, groupName: 'Almacén' }),
        });
        const result = (await response.json());
        expect(response.status).toBe(200);
        expect(result.data).toMatchObject({ updatedProducts: 1, failedProducts: 0 });
        expect(groupName).toBe('Almacén');
        expect(productDepartment).toBe('Almacén');
    });
    it('clears linked departments before deleting a group', async () => {
        const response = await fetch(`${baseUrl}/api/product-groups/11`, {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ shopId: 3 }),
        });
        const result = (await response.json());
        expect(response.status).toBe(200);
        expect(result.data).toMatchObject({ deleted: true, unassignedProducts: 1 });
        expect(productDepartment).toBeNull();
        expect(deletedGroupIds).toEqual([11]);
    });
    it('rejects deleting a group that still has subgroups', async () => {
        includeChild = true;
        const response = await fetch(`${baseUrl}/api/product-groups/11`, {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ shopId: 3 }),
        });
        const result = (await response.json());
        expect(response.status).toBe(409);
        expect(result.error.code).toBe('HAS_SUBGROUPS');
        expect(productDepartment).toBe('Bebidas');
        expect(deletedGroupIds).toEqual([]);
    });
});
//# sourceMappingURL=productGroups.test.js.map