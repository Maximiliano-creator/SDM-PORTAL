import { z } from 'zod';

export const ScaleSchema = z.object({
  termId: z.number().int(),
  termName: z.string(),
  shopId: z.number().int(),
  shopCode: z.string().nullable().optional(),
  shopName: z.string().nullable().optional(),
  ipAddress: z.string(),
  macAddr: z.string().nullable().optional(),
  netmask: z.string().nullable().optional(),
  gateway: z.string().nullable().optional(),
  bindingStatus: z.number().int().nullable().optional(),
  onlineStatus: z.number().int().nullable().optional(),
  termStatus: z.union([z.number().int(), z.boolean()]).nullable().optional(),
  version: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  boardSn: z.string().nullable().optional(),
  sequenceNo: z.string().nullable().optional(),
  iotSn: z.string().nullable().optional(),
  scaleNum: z.string().nullable().optional(),
  aiSn: z.string().nullable().optional(),
  aiClientId: z.string().nullable().optional(),
  aiClientName: z.string().nullable().optional(),
  termType: z.string().nullable().optional(),
  lastCommunicationTime: z.string().nullable().optional(),
  lastSyncTermGoodsTime: z.string().nullable().optional(),
  incGoodsIssueTime: z.string().nullable().optional(),
  completeGoodsIssueTime: z.string().nullable().optional(),
  lastPictureIssueTime: z.string().nullable().optional(),
  isMaster: z.union([z.number().int(), z.boolean()]).nullable().optional(),
  createTime: z.string().nullable().optional(),
  updateTime: z.string().nullable().optional(),
});
export type Scale = z.infer<typeof ScaleSchema>;

export const ShopSchema = z.object({
  shopId: z.number().int(),
  shopCode: z.string(),
  shopName: z.string(),
  isCloud: z.number().int().nullable().optional(),
  isHeadquarters: z.number().int().nullable().optional(),
  closeTime: z.string().nullable().optional(),
  deleteFlag: z.number().int().nullable().optional(),
  createTime: z.string().nullable().optional(),
});
export type Shop = z.infer<typeof ShopSchema>;
