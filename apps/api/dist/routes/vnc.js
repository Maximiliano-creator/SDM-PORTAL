import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { requireAuth } from '../auth/middleware.js';
import { termRequest } from '../upstream/termAdmin.js';
import { getMirrorScales, upsertScales } from '../db/mirror.js';
import { ensureTokenForIp, isTokenRegistered, isValidIp } from '../upstream/websockify.js';
import { getVncPortForScale } from '../db/settings.js';
import { probeTcp } from '../vnc/probe.js';
import { db } from '../db/client.js';
export const vncRouter = Router();
vncRouter.use(requireAuth);
const TICKET_TTL_MS = 30_000;
const tickets = new Map();
export function consumeTicket(ticket) {
    const t = tickets.get(ticket);
    if (!t)
        return null;
    tickets.delete(ticket);
    if (Date.now() - t.createdAt > TICKET_TTL_MS)
        return null;
    return t;
}
function gcTickets() {
    const cutoff = Date.now() - TICKET_TTL_MS;
    for (const [k, v] of tickets) {
        if (v.createdAt < cutoff)
            tickets.delete(k);
    }
}
/**
 * Registra la balanza en el token file de websockify a través de term_admin.
 * `SysConfigServiceImpl.getNovncAddress` es el dueño de ese archivo: escribe
 * `<ip>: <ip>:<puerto>` usando `novnc_config_file` de `sys_config`.
 *
 * Para tiendas locales el puerto lo fija term_admin en 5900; para tiendas cloud
 * se usa el `port` recibido contra el relay público. Pasamos siempre el puerto
 * configurado en la balanza para no dejar `null` en el archivo.
 */
async function registerWithTermAdmin(ip, port, termId, shopId) {
    try {
        const address = await termRequest('/api/sysConfig/getNovncAddress', {
            method: 'POST',
            body: { ip, port: String(port), termId: String(termId), shopId },
        });
        return { ok: true, address: typeof address === 'string' ? address : null };
    }
    catch (err) {
        return {
            ok: false,
            address: null,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}
vncRouter.post('/vnc/:termId/ticket', async (req, res, next) => {
    try {
        const termId = Number(req.params.termId);
        if (!Number.isFinite(termId)) {
            res.status(400).json({
                ok: false,
                error: { code: 'BAD_ID', message: 'id de balanza inválido' },
            });
            return;
        }
        let list = [];
        try {
            const live = await termRequest('/api/termInfo/all');
            upsertScales(live);
            list = live;
        }
        catch {
            list = getMirrorScales().data;
        }
        const scale = list.find((s) => s.termId === termId);
        if (!scale) {
            res
                .status(404)
                .json({ ok: false, error: { code: 'NOT_FOUND', message: 'Balanza no encontrada' } });
            return;
        }
        if (!scale.ipAddress || !isValidIp(scale.ipAddress)) {
            res.status(409).json({
                ok: false,
                error: {
                    code: 'NO_IP',
                    message: 'La balanza no tiene IP registrada o es inválida',
                },
            });
            return;
        }
        const ip = scale.ipAddress;
        const port = getVncPortForScale(termId);
        // El estado "online" de term_admin es un heartbeat que puede estar vencido
        // aunque la balanza responda. La fuente de verdad para el control remoto es
        // si el puerto VNC está abierto, así que sondeamos el puerto directamente.
        const probe = await probeTcp(ip, port);
        // Registramos la balanza en el token file de websockify (term_admin primero).
        await registerWithTermAdmin(ip, port, termId, scale.shopId ?? -1);
        let tokenRegistered = isTokenRegistered(ip);
        if (!tokenRegistered) {
            try {
                await ensureTokenForIp(ip, port);
                tokenRegistered = isTokenRegistered(ip);
            }
            catch (err) {
                req.log?.warn?.({ err, ip }, 'No se pudo escribir el token.conf de websockify');
            }
        }
        if (!probe.ok) {
            const hint = probe.reason === 'refused'
                ? ` En la balanza: Servicios Locales → Control Remoto → puerto ${port}, y el servicio debe quedar habilitado.`
                : probe.reason === 'timeout'
                    ? ` Revisá el firewall de la balanza para el puerto ${port}.`
                    : '';
            res.status(409).json({
                ok: false,
                error: {
                    code: 'VNC_UNREACHABLE',
                    message: (probe.message ?? `No se pudo conectar al servicio de Control Remoto en ${ip}:${port}.`) +
                        hint,
                },
                data: {
                    ip,
                    port,
                    probe,
                    tokenRegistered,
                    upstreamStatus: scale.onlineStatus ?? null,
                },
            });
            return;
        }
        gcTickets();
        const ticket = randomUUID();
        const user = req.user;
        tickets.set(ticket, {
            ticket,
            termId,
            termName: scale.termName ?? `Balanza ${termId}`,
            ip,
            port,
            userId: user.sub,
            username: user.username,
            createdAt: Date.now(),
        });
        res.json({
            ok: true,
            data: {
                ticket,
                termId,
                termName: scale.termName,
                ip,
                port,
                expiresInMs: TICKET_TTL_MS,
                wsPath: `/api/vnc/ws?ticket=${encodeURIComponent(ticket)}`,
                probe,
                tokenRegistered,
                upstreamStatus: scale.onlineStatus ?? null,
            },
        });
    }
    catch (err) {
        next(err);
    }
});
const recentSessions = db.prepare(`
  SELECT id, user_id, username, term_id, ip, started_at, ended_at, ended_reason,
         bytes_up, bytes_down
  FROM vnc_sessions
  ORDER BY started_at DESC
  LIMIT ?
`);
vncRouter.get('/vnc/sessions', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const rows = recentSessions.all(limit);
    res.json({ ok: true, data: rows });
});
/**
 * Diagnóstico del control remoto para una balanza: responde qué IP y puerto
 * está usando el portal y si el servicio VNC está escuchando.
 */
vncRouter.get('/vnc/:termId/diagnose', async (req, res) => {
    const termId = Number(req.params.termId);
    if (!Number.isFinite(termId)) {
        res.status(400).json({ ok: false, error: { code: 'BAD_ID', message: 'id inválido' } });
        return;
    }
    let scale;
    try {
        const live = await termRequest('/api/termInfo/all');
        scale = live.find((s) => s.termId === termId);
    }
    catch {
        scale = getMirrorScales().data.find((s) => s.termId === termId);
    }
    if (!scale?.ipAddress) {
        res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Balanza no encontrada' } });
        return;
    }
    const port = getVncPortForScale(termId);
    const probe = await probeTcp(scale.ipAddress, port);
    res.json({
        ok: true,
        data: {
            termId,
            ip: scale.ipAddress,
            port,
            onlineStatus: scale.onlineStatus ?? null,
            tokenRegistered: isTokenRegistered(scale.ipAddress),
            probe,
        },
    });
});
//# sourceMappingURL=vnc.js.map