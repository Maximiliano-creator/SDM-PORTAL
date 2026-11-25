import type { NextFunction, Request, Response } from 'express';
import { db } from '../db/client.js';
import { findUserById } from '../db/users.js';
import { clearSessionCookies, getSessionCookie, hasValidCsrf } from './cookies.js';
import { verifyToken, type SessionPayload } from './jwt.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header('authorization');
  const cookieToken = getSessionCookie(req);
  const bearerToken = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null;
  const token = cookieToken ?? bearerToken;
  if (!token) {
    res
      .status(401)
      .json({ ok: false, error: { code: 'NO_TOKEN', message: 'Token requerido' } });
    return;
  }
  const payload = verifyToken(token);
  if (!payload) {
    if (cookieToken) clearSessionCookies(res);
    res
      .status(401)
      .json({ ok: false, error: { code: 'INVALID_TOKEN', message: 'Token inválido o expirado' } });
    return;
  }

  const session = db
    .prepare<[string, number, number], { user_id: number }>(
      'SELECT user_id FROM auth_sessions WHERE id = ? AND user_id = ? AND expires_at > ? AND revoked_at IS NULL',
    )
    .get(payload.sid, payload.sub, Date.now());
  const user = session ? findUserById(payload.sub) : null;
  if (!user?.enabled) {
    if (cookieToken) clearSessionCookies(res);
    res
      .status(401)
      .json({ ok: false, error: { code: 'INVALID_TOKEN', message: 'Sesión inválida o revocada' } });
    return;
  }

  if (
    cookieToken &&
    !['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase()) &&
    !hasValidCsrf(req)
  ) {
    res.status(403).json({
      ok: false,
      error: { code: 'CSRF_INVALID', message: 'Verificación de origen inválida' },
    });
    return;
  }

  req.user = { ...payload, username: user.username, role: user.role };
  next();
}

export function requireRole(role: SessionPayload['role']) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.user?.role !== role) {
      res
        .status(403)
        .json({ ok: false, error: { code: 'FORBIDDEN', message: 'Permisos insuficientes' } });
      return;
    }
    next();
  };
}

export const requireAdmin = requireRole('admin');
