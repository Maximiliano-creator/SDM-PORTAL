import { Router } from 'express';
import argon2 from 'argon2';
import { LoginRequestSchema } from '@sdm/shared';
import { findUserByUsername, recordLogin } from '../db/users.js';
import { signToken } from './jwt.js';
import { requireAuth } from './middleware.js';
import { clearLoginFailures, loginRetryAfterSeconds, recordFailedLogin } from './loginLimiter.js';
import { clearSessionCookies, createCsrfToken, setSessionCookies } from './cookies.js';
import { logger } from '../logger.js';
import { db } from '../db/client.js';
import { getSetting } from '../db/settings.js';
import { randomUUID } from 'node:crypto';
export const authRouter = Router();
authRouter.get('/branding', (_req, res) => {
    res.json({
        ok: true,
        data: { appName: getSetting('branding.app_name') || 'SDM Portal' },
    });
});
authRouter.post('/login', async (req, res) => {
    const parsed = LoginRequestSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({
            ok: false,
            error: { code: 'VALIDATION', message: 'Datos inválidos', details: parsed.error.flatten() },
        });
        return;
    }
    const { username, password } = parsed.data;
    const clientIp = req.ip ?? 'unknown';
    const retryAfter = loginRetryAfterSeconds(clientIp, username);
    if (retryAfter !== null) {
        res.setHeader('Retry-After', String(retryAfter));
        res.status(429).json({
            ok: false,
            error: { code: 'LOGIN_RATE_LIMITED', message: 'Demasiados intentos. Espera antes de volver a probar.' },
        });
        return;
    }
    const record = findUserByUsername(username);
    const passwordMatches = record
        ? await argon2.verify(record.passwordHash, password)
        : false;
    if (!record || !record.user.enabled || !passwordMatches) {
        recordFailedLogin(clientIp, username);
        logger.warn({ username, ip: clientIp }, 'Failed portal login');
        res
            .status(401)
            .json({ ok: false, error: { code: 'BAD_CREDENTIALS', message: 'Usuario o contraseña inválidos' } });
        return;
    }
    clearLoginFailures(clientIp, username);
    recordLogin(record.user.id);
    const sessionId = randomUUID();
    const { token, expiresAt } = signToken({
        sub: record.user.id,
        username: record.user.username,
        role: record.user.role,
    }, sessionId);
    db.prepare('INSERT INTO auth_sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(sessionId, record.user.id, Date.parse(expiresAt));
    setSessionCookies(res, token, createCsrfToken(), expiresAt);
    db.prepare("INSERT INTO audit_log (user_id, action, ip, request_id) VALUES (?, 'LOGIN', ?, ?)").run(record.user.id, clientIp, req.header('x-request-id') ?? null);
    logger.info({ userId: record.user.id, username }, 'User login');
    res.json({ ok: true, data: { user: record.user, expiresAt } });
});
authRouter.get('/me', requireAuth, (req, res) => {
    const record = findUserByUsername(req.user.username);
    if (!record || !record.user.enabled) {
        res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Usuario no encontrado' } });
        return;
    }
    res.json({ ok: true, data: record.user });
});
authRouter.post('/logout', requireAuth, (req, res) => {
    db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(Date.now(), req.user.sid);
    db.prepare("INSERT INTO audit_log (user_id, action, ip) VALUES (?, 'LOGOUT', ?)").run(req.user.sub, req.ip ?? null);
    clearSessionCookies(res);
    res.json({ ok: true, data: { loggedOut: true } });
});
//# sourceMappingURL=routes.js.map