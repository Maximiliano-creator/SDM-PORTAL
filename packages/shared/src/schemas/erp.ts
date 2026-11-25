import { z } from 'zod';

/**
 * Schema externo público — el que el ERP del cliente envía a
 * `POST /api/erp/products`. Nombres en snake_case amigables y campos
 * comunes; el BFF lo mapea a la shape interna de `shopGoodsInfo` de BLS.
 *
 * `plu` es la única clave obligatoria de identidad; el resto puede
 * faltar si es una actualización parcial (e.g. solo cambio de precio).
 */
export const ErpProductInputSchema = z.object({
  plu: z.string().min(1).max(32),
  name: z.string().min(1).max(128).optional(),
  price: z.coerce.number().nonnegative().optional(),
  member_price: z.coerce.number().nonnegative().nullable().optional(),
  promotion_price: z.coerce.number().nonnegative().nullable().optional(),
  unit: z.string().max(16).optional(),
  /** 0 = pesable, 1 = conteo. Default: 0 (pesable, lo más común en balanzas). */
  price_model: z.union([z.literal(0), z.literal(1)]).optional(),
  dept_code: z.string().max(32).optional(),
  barcode: z.string().max(32).optional(),
  barcode_type: z.string().max(8).optional(),
  brand: z.string().max(64).optional(),
  spec: z.string().max(128).optional(),
  origin: z.string().max(64).optional(),
  quality_period_days: z.coerce.number().int().nonnegative().optional(),
  /** Campo opcional para que el ERP indique a qué tienda apuntar; si no, se usa el default del payload. */
  shop_code: z.string().max(32).optional(),
});
export type ErpProductInput = z.infer<typeof ErpProductInputSchema>;

export const ErpPushPayloadSchema = z.object({
  /** Código de tienda BLS (shop_info.shop_code). Aplica a todos los items que no traigan shop_code propio. */
  shop_code: z.string().min(1),
  /**
   * - `incremental`: upsert por PLU; default
   * - `full`: en v1 se trata igual que incremental (sin borrado de stale); reservado para futuro
   */
  mode: z.enum(['incremental', 'full']).default('incremental'),
  items: z.array(ErpProductInputSchema).min(1).max(1000),
});
export type ErpPushPayload = z.infer<typeof ErpPushPayloadSchema>;

export interface ErpSyncResult {
  syncId: number;
  shopCode: string;
  mode: 'incremental' | 'full';
  total: number;
  created: number;
  updated: number;
  failed: number;
  success: number;
  durationMs: number;
  errors: { row: number; plu: string; error: string }[];
}
