import { z } from 'zod';

export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  requestId: z.string().optional(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const ApiSuccessSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    ok: z.literal(true),
    data,
  });

export const ApiFailureSchema = z.object({
  ok: z.literal(false),
  error: ApiErrorSchema,
});
export type ApiFailure = z.infer<typeof ApiFailureSchema>;

export const HealthSchema = z.object({
  status: z.enum(['up', 'degraded', 'down']),
  version: z.string(),
  uptime: z.number(),
  upstream: z.object({
    termAdmin: z.enum(['up', 'down', 'unknown']),
  }),
});
export type Health = z.infer<typeof HealthSchema>;
