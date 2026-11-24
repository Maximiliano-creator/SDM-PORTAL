import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { getAllSettings, setSetting } from '../db/settings.js';
import { invalidateUpstreamToken, pingTermAdmin } from '../upstream/termAdmin.js';
import { db } from '../db/client.js';
export const settingsRouter = Router();
settingsRouter.use(requireAuth);
const SettingsUpdateSchema = z.object({
    'term_admin.url': z.string().url().optional(),
    'term_admin.username': z.string().min(1).max(64).optional(),
    'term_admin.password': z.string().min(1).max(256).optional(),
    'branding.app_name': z.string().min(1).max(64).optional(),
    'branding.primary': z.string().optional(),
});
settingsRouter.get('/settings', (_req, res) => {
    const all = getAllSettings();
    // No exponer la password al frontend en texto plano
    if ('term_admin.password' in all) {
        all['term_admin.password'] = all['term_admin.password'] ? '••••••••' : '';
    }
    res.json({ ok: true, data: all });
});
settingsRouter.put('/settings', (req, res, next) => {
    try {
        if (req.user?.role !== 'admin') {
            res
                .status(403)
                .json({ ok: false, error: { code: 'FORBIDDEN', message: 'Solo admin puede editar settings' } });
            return;
        }
        const parsed = SettingsUpdateSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({
                ok: false,
                error: { code: 'VALIDATION', message: 'Datos inválidos', details: parsed.error.flatten() },
            });
            return;
        }
        const changed = [];
        for (const [key, value] of Object.entries(parsed.data)) {
            if (value === undefined || value === '••••••••')
                continue;
            setSetting(key, value);
            changed.push(key);
        }
        if (changed.some((k) => k.startsWith('term_admin.'))) {
            invalidateUpstreamToken();
        }
        db.prepare("INSERT INTO audit_log (user_id, action, target, ip) VALUES (?, 'SETTINGS_UPDATE', ?, ?)").run(req.user.sub, changed.join(','), req.ip ?? null);
        res.json({ ok: true, data: { changed } });
    }
    catch (err) {
        next(err);
    }
});
settingsRouter.post('/settings/test-upstream', async (_req, res) => {
    const result = await pingTermAdmin();
    res.json({
        ok: true,
        data: {
            reachable: result.ok,
            version: result.version ?? null,
            error: result.error ?? null,
        },
    });
});
//# sourceMappingURL=settings.js.map