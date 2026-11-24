import { verifyToken } from './jwt.js';
export function requireAuth(req, res, next) {
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
//# sourceMappingURL=middleware.js.map