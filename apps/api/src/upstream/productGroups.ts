import type { PagedResponse, Product } from '@sdm/shared';
import { termRequest } from './termAdmin.js';

const PAGE_SIZE = 200;

export interface ShopGoodGroup {
  id: number;
  shopId: number;
  pid: number;
  groupNum: number;
  groupName: string;
  sortNo?: number;
  enabled?: boolean;
}

export interface ShopGoodGroupRelation {
  relatedId: number;
  shopId: number;
  goodCode: string;
  groupId: number;
  subgroupId: number;
}

export function normalizeProductGroupName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export async function listShopGoodGroups(shopId: number): Promise<ShopGoodGroup[]> {
  const groups: ShopGoodGroup[] = [];
  let page = 0;
  while (true) {
    const response = await termRequest<PagedResponse<ShopGoodGroup>>('/api/shopGoodGroup', {
      query: { page, size: PAGE_SIZE, sort: 'sortNo,asc', shopId },
    });
    groups.push(...response.content);
    if (response.last || response.content.length < PAGE_SIZE) return groups;
    page++;
  }
}

export async function createShopGoodGroup(
  shopId: number,
  groupName: string,
  sortNo: number,
): Promise<ShopGoodGroup> {
  const groupNum = await termRequest<number>('/api/shopGoodGroup/generateNewGroupNum', {
    query: { shopId, pId: 0 },
  });
  if (!Number.isFinite(groupNum)) {
    throw new Error(`term_admin devolvió un número de grupo inválido para "${groupName}"`);
  }

  const group = await termRequest<ShopGoodGroup>('/api/shopGoodGroup', {
    method: 'POST',
    body: { shopId, pid: 0, groupNum, groupName, sortNo, enabled: true },
  });
  if (!Number.isFinite(group?.id)) {
    throw new Error(`term_admin no devolvió el identificador del grupo "${groupName}"`);
  }
  return group;
}

export async function listShopGoodGroupRelations(
  shopId: number,
  filters: { groupId?: number; goodCode?: string } = {},
): Promise<ShopGoodGroupRelation[]> {
  const relations: ShopGoodGroupRelation[] = [];
  let page = 0;
  while (true) {
    const response = await termRequest<PagedResponse<ShopGoodGroupRelation>>(
      '/api/shopGoodGroupRlt',
      {
        query: { page, size: PAGE_SIZE, sort: 'sortNo,asc', shopId, ...filters },
      },
    );
    relations.push(...response.content);
    if (response.last || response.content.length < PAGE_SIZE) return relations;
    page++;
  }
}

export async function listShopProducts(shopId: number): Promise<Product[]> {
  const products: Product[] = [];
  let page = 0;
  while (true) {
    const response = await termRequest<PagedResponse<Product>>('/api/shopGoodsInfo', {
      query: { page, size: PAGE_SIZE, shopId },
    });
    products.push(...response.content.filter((product) => product.shopId === shopId));
    if (response.last || response.content.length < PAGE_SIZE) return products;
    page++;
  }
}

export async function listShopProductsByGoodCodes(
  shopId: number,
  goodCodes: Iterable<string>,
): Promise<Product[]> {
  const wanted = new Set(goodCodes);
  if (wanted.size === 0) return [];
  return (await listShopProducts(shopId)).filter(
    (product) => typeof product.goodCode === 'string' && wanted.has(product.goodCode),
  );
}

export async function updateShopProductDepartment(
  product: Product,
  deptCode: string | null,
): Promise<void> {
  await termRequest('/api/shopGoodsInfo', {
    method: 'PUT',
    body: { ...product, deptCode },
  });
}

export async function createShopGoodGroupRelations(
  shopId: number,
  groupId: number,
  goodCodeList: string[],
): Promise<void> {
  if (goodCodeList.length === 0) return;
  await termRequest('/api/shopGoodGroupRlt/createBatch', {
    method: 'POST',
    body: { shopId, groupId, subgroupId: 0, goodCodeList },
  });
}

export async function deleteShopGoodGroupRelations(
  shopId: number,
  groupId: number,
  subgroupId: number,
  goodCodeList: string[],
): Promise<void> {
  if (goodCodeList.length === 0) return;
  await termRequest('/api/shopGoodGroupRlt/deleteBatch', {
    method: 'DELETE',
    body: { shopId, groupId, subgroupId, goodCodeList },
  });
}
