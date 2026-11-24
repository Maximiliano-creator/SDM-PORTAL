import { z } from 'zod';

/** Modo de precio: 0 = pesable, 1 = conteo */
export const PriceModelSchema = z.union([z.literal(0), z.literal(1)]);
export type PriceModel = z.infer<typeof PriceModelSchema>;

/**
 * Producto del catálogo. Mapea a la fila de shop_goods_info de BLS,
 * exponiendo solo los campos útiles. El backend BLS devuelve muchos más
 * (shopGoodsExendInfo, shopGoodsNutritionInfoDtoList, etc.) que ignoramos
 * por ahora.
 */
export const ProductSchema = z.object({
  shopGoodId: z.number().int(),
  shopId: z.number().int(),
  shopCode: z.string(),

  goodsPlu: z.string(),
  goodCode: z.string().nullable().optional(),
  itemCode: z.string().nullable().optional(),

  goodsName: z.string(),
  goodsAlias: z.string().nullable().optional(),
  unitName: z.string().nullable().optional(),
  priceModel: PriceModelSchema,

  price: z.number().nullable().optional(),
  memberPrice: z.number().nullable().optional(),
  promotionPrice: z.number().nullable().optional(),
  originPrice: z.number().nullable().optional(),

  deptCode: z.string().nullable().optional(),
  barCode: z.string().nullable().optional(),
  barCodeType: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
  spec: z.string().nullable().optional(),
  origin: z.string().nullable().optional(),

  priceVariable: z.string().nullable().optional(),
  qualityPeriod: z.number().nullable().optional(),
  imagePath: z.string().nullable().optional(),

  state: z.number().int().nullable().optional(),
  syncTermStatus: z.number().int().nullable().optional(),
  downTermEnabled: z.number().int().nullable().optional(),

  createTime: z.string().nullable().optional(),
  updateTime: z.string().nullable().optional(),
});
export type Product = z.infer<typeof ProductSchema>;

/**
 * Respuesta paginada genérica del backend BLS (formato Spring Data Page).
 * Página 0-indexed.
 */
export const PagedSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    content: z.array(item),
    totalElements: z.number().int(),
    state: z.number().int().optional(),
    last: z.boolean().optional(),
    totalPages: z.number().int().optional(),
  });

export interface PagedResponse<T> {
  content: T[];
  totalElements: number;
  state?: number;
  last?: boolean;
  totalPages?: number;
}

export const ProductsPagedSchema = PagedSchema(ProductSchema);
export type ProductsPaged = z.infer<typeof ProductsPagedSchema>;

/** Filtros aceptados al listar productos. */
export const ProductFiltersSchema = z.object({
  page: z.coerce.number().int().min(0).default(0),
  size: z.coerce.number().int().min(1).max(2000).default(50),
  goodsName: z.string().optional(),
  goodsPlu: z.string().optional(),
  shopId: z.coerce.number().int().optional(),
  priceModel: z.coerce.number().int().optional(),
  deptCode: z.string().optional(),
});
export type ProductFilters = z.infer<typeof ProductFiltersSchema>;

/** Cambio de precio individual. */
export const PriceUpdateSchema = z.object({
  shopGoodId: z.number().int(),
  price: z.number().nonnegative().optional(),
  memberPrice: z.number().nonnegative().nullable().optional(),
  promotionPrice: z.number().nonnegative().nullable().optional(),
});
export type PriceUpdate = z.infer<typeof PriceUpdateSchema>;

/** Cambio masivo: aplicar % o monto fijo a una lista de productos. */
export const BulkPriceUpdateSchema = z.object({
  shopGoodIds: z.array(z.number().int()).min(1).max(2000),
  mode: z.enum(['percent', 'fixed', 'set']),
  value: z.number(),
  field: z.enum(['price', 'memberPrice', 'promotionPrice']).default('price'),
});
export type BulkPriceUpdate = z.infer<typeof BulkPriceUpdateSchema>;
