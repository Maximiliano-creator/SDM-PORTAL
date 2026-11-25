// Route to proxy or redirect Term Admin remote control request
import { Router } from 'express';
import { logger } from '../logger.js';
import { requireAdmin, requireAuth } from '../auth/middleware.js';
import { isValidIp } from '../upstream/websockify.js';
const router = Router();
router.use(requireAuth, requireAdmin);
/**
 * GET /service/api/ctrlAltdel
 * Expected query params: ip, shopId
 * Responds with a 302 redirect to the Term Admin UI page that opens the VNC client.
 */
router.get('/ctrlAltdel', (req, res) => {
    const { ip, shopId } = req.query;
    if (!ip || !isValidIp(ip) || !shopId || !Number.isSafeInteger(Number(shopId))) {
        logger.warn({ ip, shopId }, 'Missing ip or shopId for ctrlAltdel');
        return res.status(400).json({ error: 'Missing ip or shopId' });
    }
    const base = process.env.TERM_ADMIN_URL || 'http://localhost:19697';
    const target = `${base}/ctrlAltdel?ip=${encodeURIComponent(ip)}&shopId=${encodeURIComponent(shopId)}`;
    logger.info({ target }, 'Redirecting to Term Admin remote control');
    res.redirect(302, target);
});
export default router;
//# sourceMappingURL=ctrlAltdel.js.map