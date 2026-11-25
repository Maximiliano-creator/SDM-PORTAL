import { z } from 'zod';

export const UserRoleSchema = z.enum(['admin', 'operator']);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const UserSchema = z.object({
  id: z.number().int().positive(),
  username: z.string().min(1).max(64),
  fullName: z.string().max(128).nullable(),
  role: UserRoleSchema,
  enabled: z.boolean(),
  createdAt: z.string().datetime({ offset: true }).or(z.string()),
  lastLoginAt: z.string().nullable(),
});
export type User = z.infer<typeof UserSchema>;

export const LoginRequestSchema = z.object({
  username: z.string().min(1, 'Usuario requerido').max(64),
  password: z.string().min(1, 'Contraseña requerida').max(256),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const AuthSessionSchema = z.object({
  user: UserSchema,
  expiresAt: z.string(),
});
export type AuthSession = z.infer<typeof AuthSessionSchema>;
