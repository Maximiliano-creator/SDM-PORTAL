import { z } from 'zod';

/** Línea de venta (term_goods_order) — una fila por ítem pesado/contado. */
export const OrderSchema = z.object({
  shopId: z.number().int(),
  termId: z.number().int(),
  flowid: z.number().int().nullable().optional(),
  goodsPlu: z.string(),
  goodsName: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
  price: z.number().nullable().optional(),
  orderPrice: z.number().nullable().optional(),
  subtotal: z.number().nullable().optional(),
  quantity: z.number().nullable().optional(),
  weight: z.number().nullable().optional(),
  scaleNum: z.string().nullable().optional(),
  operId: z.string().nullable().optional(),
  operName: z.string().nullable().optional(),
  orderTime: z.string().nullable().optional(),
  daySeq: z.string().nullable().optional(),
  deptId: z.string().nullable().optional(),
  barcode: z.string().nullable().optional(),
  sid: z.string().nullable().optional(),
  cancelFlag: z.number().int().nullable().optional(),
  cancelTime: z.string().nullable().optional(),
  verificationFlag: z.number().int().nullable().optional(),
  abnormalType: z.number().int().nullable().optional(),
  createTime: z.string().nullable().optional(),
  updateTime: z.string().nullable().optional(),
});
export type Order = z.infer<typeof OrderSchema>;

/** Estadística diaria por balanza/producto (iot_pan_statistic_day). */
export const PanStatDaySchema = z.object({
  id: z.number().int(),
  shopId: z.number().int().nullable().optional(),
  goodCode: z.string().nullable().optional(),
  goodsName: z.string().nullable().optional(),
  weightValueBegin: z.number().nullable().optional(),
  weightBeginTime: z.string().nullable().optional(),
  weightValueEnd: z.number().nullable().optional(),
  weightEndTime: z.string().nullable().optional(),
  weightValueRestock: z.number().nullable().optional(),
  weightValueSale: z.number().nullable().optional(),
  statisticDate: z.string().nullable().optional(),
  createTime: z.string().nullable().optional(),
});
export type PanStatDay = z.infer<typeof PanStatDaySchema>;

export const OrderFiltersSchema = z.object({
  page: z.coerce.number().int().min(0).default(0),
  size: z.coerce.number().int().min(1).max(2000).default(50),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  shopId: z.coerce.number().int().optional(),
  termId: z.coerce.number().int().optional(),
  operId: z.string().optional(),
  cancelFlag: z.coerce.number().int().optional(),
});
export type OrderFilters = z.infer<typeof OrderFiltersSchema>;
