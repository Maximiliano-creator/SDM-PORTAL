import { db } from '../db/client.js';
import { logger } from '../logger.js';
const TRACKED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const IGNORED_PATHS = new Set(['/api/auth/login', '/api/auth/logout', '/api/erp/products']);
const insertStmt = db.prepare('INSERT INTO audit_log (user_id, action, target, ip, request_id, payload) VALUES (?, ?, ?, ?, ?, ?)');
export function auditMiddleware(req, res, next) {
    if (!TRACKED_METHODS.has(req.method) || IGNORED_PATHS.has(req.path)) {
        next();
        return;
    }
    res.on('finish', () => {
        if (!req.user)
            return;
        if (res.statusCode >= 400)
            return;
        try {
            insertStmt.run(req.user.sub, `${req.method} ${req.path}`, req.params.id ?? null, req.ip ?? null, req.headers['x-request-id'] ?? null, null);
        }
        catch (err) {
            logger.error({ err, requestId: req.headers['x-request-id'] }, 'No se pudo registrar la auditoría');
        }
    });
    next();
}
//# sourceMappingURL=middleware.js.map