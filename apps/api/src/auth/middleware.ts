import type { NextFunction, Request, Response } from 'express';
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
  if (!header || !header.startsWith('Bearer ')) {
    res
      .status(401)
      .json({ ok: false, error: { code: 'NO_TOKEN', message: 'Token requerido' } });
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  const payload = verifyToken(token);
  if (!payload) {
    res
      .status(401)
      .json({ ok: false, error: { code: 'INVALID_TOKEN', message: 'Token inválido o expirado' } });
    return;
  }
  req.user = payload;
  next();
}
