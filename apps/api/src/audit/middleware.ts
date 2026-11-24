import type { NextFunction, Request, Response } from 'express';
import { db } from '../db/client.js';

const TRACKED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const IGNORED_PATHS = new Set(['/api/auth/login', '/api/auth/logout', '/api/erp/products']);

const insertStmt = db.prepare(
  'INSERT INTO audit_log (user_id, action, target, ip, request_id, payload) VALUES (?, ?, ?, ?, ?, ?)',
);

export function auditMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!TRACKED_METHODS.has(req.method) || IGNORED_PATHS.has(req.path)) {
    next();
    return;
  }
  res.on('finish', () => {
    if (!req.user) return;
    if (res.statusCode >= 400) return;
    try {
      const payload = req.body ? JSON.stringify(req.body).slice(0, 1024) : null;
      insertStmt.run(
        req.user.sub,
        `${req.method} ${req.path}`,
        req.params.id ?? null,
        req.ip ?? null,
        (req.headers['x-request-id'] as string) ?? null,
        payload,
      );
    } catch {
      // no romper la respuesta por error de audit
    }
  });
  next();
}
