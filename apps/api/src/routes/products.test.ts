import type { AddressInfo } from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { termRequestMock } = vi.hoisted(() => ({
  termRequestMock: vi.fn(),
}));

vi.mock('../auth/middleware.js', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    Object.assign(req, { user: { sub: 1 } });
    next();
  },
  requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock('../upstream/termAdmin.js', () => ({
  termRequest: (...args: unknown[]) => termRequestMock(...args),
}));

import { productsRouter } from './products.js';

let server: ReturnType<ReturnType<typeof express>['listen']>;
let baseUrl: string;
let productDepartment: string | null;
let createdRelations: unknown[];
let deletedRelations: unknown[];
let productIdQueries: Record<string, unknown>[];

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
  productDepartment = 'Bebidas';
  createdRelations = [];
  deletedRelations = [];
  productIdQueries = [];
  termRequestMock.mockReset();
  termRequestMock.mockImplementation(
    async (
      path: string,
      options?: {
        method?: string;
        query?: Record<string, unknown>;
        body?: unknown;
      },
    ) => {
      if (path === '/api/shopGoodsInfo' && !options?.method) {
        if (options && options.query) productIdQueries.push(options.query);
        return { content: [{ ...product, deptCode: productDepartment }], last: true };
      }
      if (path === '/api/shopGoodGroup' && !options?.method) {
        return {
          content: [
            { id: 11, shopId: 3, pid: 0, groupNum: 5, groupName: 'Bebidas' },
            { id: 12, shopId: 3, pid: 0, groupNum: 6, groupName: 'Almacén' },
          ],
          last: true,
        };
      }
      if (path === '/api/shopGoodGroupRlt' && !options?.method) {
        return {
          content: [
            { relatedId: 1, shopId: 3, goodCode: 'GOOD-100', groupId: 11, subgroupId: 0 },
            { relatedId: 2, shopId: 3, goodCode: 'GOOD-100', groupId: 11, subgroupId: 7 },
          ],
          last: true,
        };
      }
      if (path === '/api/shopGoodsInfo' && options?.method === 'PUT') {
        productDepartment = (options.body as { deptCode: string | null }).deptCode;
        return undefined;
      }
      if (path === '/api/shopGoodGroupRlt/createBatch') {
        createdRelations.push(options?.body);
        return undefined;
      }
      if (path === '/api/shopGoodGroupRlt/deleteBatch') {
        deletedRelations.push(options?.body);
        return undefined;
      }
      throw new Error(`Llamada upstream inesperada: ${path}`);
    },
  );

  const app = express();
  app.use(express.json());
  app.use('/api', productsRouter);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe('POST /products/bulk-department', () => {
  it('updates deptCode, links the target group, and removes the previous department link', async () => {
    const response = await fetch(`${baseUrl}/api/products/bulk-department`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shopGoodIds: [31], groupId: 12, shopId: 3 }),
    });
    const result = (await response.json()) as {
      data: { requested: number; updated: number; failed: number };
    };

    expect(response.status).toBe(200);
    expect(result.data).toMatchObject({ requested: 1, updated: 1, failed: 0 });
    expect(productIdQueries).toContainEqual(expect.objectContaining({ shopGoodIdList: '31' }));
    expect(productDepartment).toBe('Almacén');
    expect(createdRelations).toEqual([
      { shopId: 3, groupId: 12, subgroupId: 0, goodCodeList: ['GOOD-100'] },
    ]);
    expect(deletedRelations).toEqual([
      { shopId: 3, groupId: 11, subgroupId: 0, goodCodeList: ['GOOD-100'] },
      { shopId: 3, groupId: 11, subgroupId: 7, goodCodeList: ['GOOD-100'] },
    ]);
  });
});
