import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { logger } from '../logger.js';
import { termRequest } from '../upstream/termAdmin.js';
import {
  createShopGoodGroup,
  listShopGoodGroupRelations,
  listShopGoodGroups,
  listShopProductsByGoodCodes,
  normalizeProductGroupName,
  updateShopProductDepartment,
  type ShopGoodGroup,
} from '../upstream/productGroups.js';

export const productGroupsRouter: Router = Router();
productGroupsRouter.use(requireAuth);

const ShopIdSchema = z.coerce.number().int().positive();
const GroupNameSchema = z.string().trim().min(1).max(30);

async function updateLinkedProductDepartments(
  products: Awaited<ReturnType<typeof listShopProductsByGoodCodes>>,
  deptCode: string | null,
) {
  const errors: { goodsPlu: string; error: string }[] = [];
  let updated = 0;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, products.length) }, async () => {
    while (cursor < products.length) {
      const product = products[cursor++];
      if (!product) continue;
      try {
        await updateShopProductDepartment(product, deptCode);
        updated++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ goodsPlu: String(product.goodsPlu ?? product.goodCode), error: message });
        logger.warn(
          { shopGoodId: product.shopGoodId, goodsPlu: product.goodsPlu, error: message },
          'Product department synchronization failed',
        );
      }
    }
  });
  await Promise.all(workers);
  return { updated, errors };
}

productGroupsRouter.get(
  '/product-groups',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const shopId = ShopIdSchema.safeParse(req.query.shopId);
      if (!shopId.success) {
        res.status(400).json({
          ok: false,
          error: { code: 'VALIDATION', message: 'shopId inválido' },
        });
        return;
      }
      const groups = await listShopGoodGroups(shopId.data);
      res.json({ ok: true, data: groups.filter((group) => group.pid === 0) });
    } catch (error) {
      next(error);
    }
  },
);

productGroupsRouter.post(
  '/product-groups',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = z
        .object({ shopId: z.number().int().positive(), groupName: GroupNameSchema })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          ok: false,
          error: {
            code: 'VALIDATION',
            message: 'Datos del grupo inválidos',
            details: parsed.error.flatten(),
          },
        });
        return;
      }
      const groups = await listShopGoodGroups(parsed.data.shopId);
      const duplicate = groups.some(
        (group) =>
          group.pid === 0 &&
          normalizeProductGroupName(group.groupName) ===
            normalizeProductGroupName(parsed.data.groupName),
      );
      if (duplicate) {
        res.status(409).json({
          ok: false,
          error: {
            code: 'DUPLICATE_GROUP',
            message: 'Ya existe un grupo con ese nombre en la tienda',
          },
        });
        return;
      }
      const sortNo =
        Math.max(
          -1,
          ...groups.filter((group) => group.pid === 0).map((group) => group.sortNo ?? -1),
        ) + 1;
      const group = await createShopGoodGroup(parsed.data.shopId, parsed.data.groupName, sortNo);
      res.status(201).json({ ok: true, data: group });
    } catch (error) {
      next(error);
    }
  },
);

productGroupsRouter.put(
  '/product-groups/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      const parsed = z
        .object({ shopId: z.number().int().positive(), groupName: GroupNameSchema })
        .safeParse(req.body);
      if (!Number.isSafeInteger(id) || id <= 0 || !parsed.success) {
        res.status(400).json({
          ok: false,
          error: {
            code: 'VALIDATION',
            message: 'Identificador o datos del grupo inválidos',
            ...(parsed.success ? {} : { details: parsed.error.flatten() }),
          },
        });
        return;
      }

      const groups = await listShopGoodGroups(parsed.data.shopId);
      const group = groups.find((candidate) => candidate.id === id && candidate.pid === 0);
      if (!group) {
        res.status(404).json({
          ok: false,
          error: { code: 'NOT_FOUND', message: 'Grupo no encontrado en la tienda seleccionada' },
        });
        return;
      }
      const duplicate = groups.some(
        (candidate) =>
          candidate.id !== id &&
          candidate.pid === 0 &&
          normalizeProductGroupName(candidate.groupName) ===
            normalizeProductGroupName(parsed.data.groupName),
      );
      if (duplicate) {
        res.status(409).json({
          ok: false,
          error: {
            code: 'DUPLICATE_GROUP',
            message: 'Ya existe un grupo con ese nombre en la tienda',
          },
        });
        return;
      }

      const updatedGroup: ShopGoodGroup = {
        id: group.id,
        shopId: group.shopId,
        pid: group.pid,
        groupNum: group.groupNum,
        groupName: parsed.data.groupName,
        sortNo: group.sortNo,
        enabled: group.enabled,
      };
      await termRequest('/api/shopGoodGroup', { method: 'PUT', body: updatedGroup });

      const relations = await listShopGoodGroupRelations(parsed.data.shopId, { groupId: id });
      const goodCodes = [
        ...new Set(relations.map((relation) => relation.goodCode).filter(Boolean)),
      ];
      const products = await listShopProductsByGoodCodes(parsed.data.shopId, goodCodes);
      const sync = await updateLinkedProductDepartments(products, parsed.data.groupName);
      res.json({
        ok: true,
        data: {
          group: updatedGroup,
          updatedProducts: sync.updated,
          failedProducts: sync.errors.length,
          errors: sync.errors,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

productGroupsRouter.delete(
  '/product-groups/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      const shopId = ShopIdSchema.safeParse(req.body?.shopId);
      if (!Number.isSafeInteger(id) || id <= 0 || !shopId.success) {
        res.status(400).json({
          ok: false,
          error: { code: 'VALIDATION', message: 'Identificador o tienda inválidos' },
        });
        return;
      }

      const groups = await listShopGoodGroups(shopId.data);
      const group = groups.find((candidate) => candidate.id === id && candidate.pid === 0);
      if (!group) {
        res.status(404).json({
          ok: false,
          error: { code: 'NOT_FOUND', message: 'Grupo no encontrado en la tienda seleccionada' },
        });
        return;
      }
      if (groups.some((candidate) => candidate.pid === id)) {
        res.status(409).json({
          ok: false,
          error: {
            code: 'HAS_SUBGROUPS',
            message: 'No se puede eliminar un grupo que contiene subgrupos',
          },
        });
        return;
      }

      const relations = await listShopGoodGroupRelations(shopId.data, { groupId: id });
      const goodCodes = [
        ...new Set(relations.map((relation) => relation.goodCode).filter(Boolean)),
      ];
      const products = await listShopProductsByGoodCodes(shopId.data, goodCodes);
      const sync = await updateLinkedProductDepartments(products, null);
      if (sync.errors.length > 0) {
        res.json({
          ok: true,
          data: {
            deleted: false,
            unassignedProducts: sync.updated,
            failedProducts: sync.errors.length,
            errors: sync.errors,
          },
        });
        return;
      }

      try {
        await termRequest('/api/shopGoodGroup', { method: 'DELETE', body: [id] });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(
          { groupId: id, shopId: shopId.data, error: message },
          'Product group deletion failed',
        );
        res.json({
          ok: true,
          data: {
            deleted: false,
            unassignedProducts: sync.updated,
            failedProducts: 0,
            errors: [{ goodsPlu: '', error: `No se eliminó el grupo: ${message}` }],
          },
        });
        return;
      }

      res.json({
        ok: true,
        data: {
          deleted: true,
          unassignedProducts: sync.updated,
          failedProducts: 0,
          errors: [],
        },
      });
    } catch (error) {
      next(error);
    }
  },
);
