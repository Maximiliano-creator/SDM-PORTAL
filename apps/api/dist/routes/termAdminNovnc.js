// Endpoint de diagnóstico del Control Remoto: expone la dirección real de
// noVNC/websockify que usa term_admin para una balanza.
//
// Rutas term_admin (verificadas contra el build v1.0.31_0430_beta):
//   POST /service/api/sysConfig/getNovncAddress  {ip, port, termId, shopId}
//     → escribe `<ip>: <ip>:<puerto>` en `novnc_config_file` y devuelve
//       el valor de `sys_config.novnc_address` (por defecto "localhost:9000").
import { Router } from 'express';
import { termRequest } from '../upstream/termAdmin.js';
import { logger } from '../logger.js';
import { getVncPortForScale } from '../db/settings.js';
import { probeTcp } from '../vnc/probe.js';
const router = Router();
/**
 * GET /service/api/term-admin/novnc
 * Query params: ip, shopId, termId (opcional), port (opcional)
 */
router.get('/novnc', async (req, res) => {
    const { ip, shopId, termId, port } = req.query;
    if (!ip || !shopId) {
        logger.warn({ ip, shopId }, 'Missing ip or shopId for novnc endpoint');
        return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Falta ip o shopId' } });
    }
    const termIdNum = Number(termId);
    const resolvedPort = port ? Number(port) : Number.isFinite(termIdNum) ? getVncPortForScale(termIdNum) : 5900;
    try {
        // Ruta real: POST /api/sysConfig/getNovncAddress (no /service/service/...).
        const address = await termRequest('/api/sysConfig/getNovncAddress', {
            method: 'POST',
            body: {
                ip,
                port: String(resolvedPort),
                termId: termId ?? String(termIdNum),
                shopId: Number(shopId),
            },
        });
        const probe = await probeTcp(ip, resolvedPort);
        res.json({
            ok: true,
            data: {
                ip,
                port: resolvedPort,
                // `novnc_address` de sys_config (host:puerto del proxy websockify).
                websockifyAddress: typeof address === 'string' ? address : null,
                // URL que debe usar el cliente noVNC: el token es la IP de la balanza.
                wsPath: `/websockify/?token=${encodeURIComponent(ip)}`,
                probe,
            },
        });
    }
    catch (e) {
        const err = e;
        logger.error({ err, ip, shopId }, 'Error fetching novnc address from term_admin');
        res.status(502).json({
            ok: false,
            error: { code: 'UPSTREAM_ERROR', message: err.message ?? 'Error contacting term_admin' },
        });
    }
});
export default router;
//# sourceMappingURL=termAdminNovnc.js.map