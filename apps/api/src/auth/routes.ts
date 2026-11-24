import { Router, type Request, type Response } from 'express';
import argon2 from 'argon2';
import { LoginRequestSchema } from '@sdm/shared';
import { findUserByUsername, recordLogin } from '../db/users.js';
import { signToken } from './jwt.js';
import { requireAuth } from './middleware.js';
import { logger } from '../logger.js';
import { db } from '../db/client.js';

export const authRouter: Router = Router();

authRouter.post('/login', async (req: Request, res: Response) => {
  const parsed = LoginRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      error: { code: 'VALIDATION', message: 'Datos inválidos', details: parsed.error.flatten() },
    });
    return;
  }
  const { username, password } = parsed.data;
  const record = findUserByUsername(username);
  if (!record || !record.user.enabled) {
    res
      .status(401)
      .json({ ok: false, error: { code: 'BAD_CREDENTIALS', message: 'Usuario o contraseña inválidos' } });
    return;
  }
  const ok = await argon2.verify(record.passwordHash, password);
  if (!ok) {
    res
      .status(401)
      .json({ ok: false, error: { code: 'BAD_CREDENTIALS', message: 'Usuario o contraseña inválidos' } });
    return;
  }
  recordLogin(record.user.id);
  const { token, expiresAt } = signToken({
    sub: record.user.id,
    username: record.user.username,
    role: record.user.role,
  });
  db.prepare(
    "INSERT INTO audit_log (user_id, action, ip, request_id) VALUES (?, 'LOGIN', ?, ?)",
  ).run(record.user.id, req.ip ?? null, req.header('x-request-id') ?? null);
  logger.info({ userId: record.user.id, username }, 'User login');
  res.json({ ok: true, data: { user: record.user, token, expiresAt } });
});

authRouter.get('/me', requireAuth, (req: Request, res: Response) => {
  const record = findUserByUsername(req.user!.username);
  if (!record) {
    res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Usuario no encontrado' } });
    return;
  }
  res.json({ ok: true, data: record.user });
});

authRouter.post('/logout', requireAuth, (req: Request, res: Response) => {
  db.prepare(
    "INSERT INTO audit_log (user_id, action, ip) VALUES (?, 'LOGOUT', ?)",
  ).run(req.user!.sub, req.ip ?? null);
  res.json({ ok: true, data: { loggedOut: true } });
});
