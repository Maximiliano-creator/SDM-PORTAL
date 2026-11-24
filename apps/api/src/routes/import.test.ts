import type { AddressInfo } from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { auditRunMock, termRequestMock } = vi.hoisted(() => ({
  auditRunMock: vi.fn(),
  termRequestMock: vi.fn(),
}));

vi.mock('../auth/middleware.js', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    Object.assign(req, { user: { sub: 1 } });
    next();
  },
}));
vi.mock('../upstream/termAdmin.js', () => ({
  termRequest: (...args: unknown[]) => termRequestMock(...args),
}));
vi.mock('../logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn() },
}));
vi.mock('../db/client.js', () => ({
  db: { prepare: vi.fn(() => ({ run: auditRunMock })) },
}));

import { importRouter } from './import.js';

let server: ReturnType<ReturnType<typeof express>['listen']>;
let baseUrl: string;
let failAssociation = false;

beforeEach(async () => {
  failAssociation = false;
  termRequestMock.mockReset();
  auditRunMock.mockReset();
  termRequestMock.mockImplementation(
    async (path: string, options?: { method?: string; body?: unknown }) => {
      if (path === '/api/shopInfo/all') return [{ shopId: 3, shopCode: 'S1' }];
      if (path === '/api/shopGoodsInfo' && !options?.method) {
        return {
          content: [{ shopId: 3, goodsPlu: '100', goodCode: 'GOOD-100' }],
          last: true,
        };
      }
      if (path === '/api/shopGoodGroup' && !options?.method) {
        return {
          content: [
            { id: 11, shopId: 3, pid: 0, groupName: 'Bebidas' },
            { id: 12, shopId: 3, pid: 11, groupName: 'Panadería' },
          ],
          last: true,
        };
      }
      if (path === '/api/shopGoodGroup/generateNewGroupNum') return 77;
      if (path === '/api/shopGoodGroup' && options?.method === 'POST') {
        return { ...(options.body as object), id: 22 };
      }
      if (path === '/api/shopGoodsInfo' && options?.method === 'POST') {
        const body = options.body as { goodsPlu: string };
        return { ...body, goodCode: `GOOD-${body.goodsPlu}` };
      }
      if (path === '/api/shopGoodGroupRlt/createBatch') {
        if (failAssociation) throw new Error('falló asociación');
        return undefined;
      }
      throw new Error(`Llamada upstream inesperada: ${path}`);
    },
  );

  const app = express();
  app.use(express.json());
  app.use('/api', importRouter);
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

describe('POST /import/products department grouping', () => {
  it('reuses existing groups and associates both existing and newly imported PLUs', async () => {
    const response = await fetch(`${baseUrl}/api/import/products`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shopCode: 'S1',
        items: [
          { shopCode: 'S1', goodsPlu: '100', goodsName: 'Agua', deptCode: 'Bebidas' },
          { shopCode: 'S1', goodsPlu: '101', goodsName: 'Pan', deptCode: 'Panadería' },
        ],
      }),
    });
    const result = (await response.json()) as {
      data: {
        created: number;
        skippedExisting: number;
        grouping: { groupsCreated: number; associated: number; failed: number };
      };
    };

    expect(response.status).toBe(200);
    expect(result.data).toMatchObject({
      created: 1,
      skippedExisting: 1,
      grouping: { groupsCreated: 1, associated: 2, failed: 0 },
    });

    const associationBodies = termRequestMock.mock.calls
      .filter(([path]) => path === '/api/shopGoodGroupRlt/createBatch')
      .map(([, options]) => (options as { body: unknown }).body);
    expect(associationBodies).toEqual(
      expect.arrayContaining([
        { shopId: 3, groupId: 11, subgroupId: 0, goodCodeList: ['GOOD-100'] },
        { shopId: 3, groupId: 22, subgroupId: 0, goodCodeList: ['GOOD-101'] },
      ]),
    );
  });

  it('reports association failures without hiding successful product imports', async () => {
    failAssociation = true;
    const response = await fetch(`${baseUrl}/api/import/products`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shopCode: 'S1',
        items: [{ shopCode: 'S1', goodsPlu: '101', goodsName: 'Pan', deptCode: 'Panadería' }],
      }),
    });
    const result = (await response.json()) as {
      data: {
        created: number;
        failed: number;
        grouping: { failed: number; errors: { department: string; error: string }[] };
      };
    };

    expect(response.status).toBe(200);
    expect(result.data.created).toBe(1);
    expect(result.data.failed).toBe(0);
    expect(result.data.grouping).toMatchObject({
      failed: 1,
      errors: [{ department: 'Panadería', error: 'falló asociación' }],
    });
  });
});
