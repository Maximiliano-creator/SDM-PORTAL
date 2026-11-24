import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { v4 as uuidv4 } from 'uuid';
import { config } from './config.js';
import { logger } from './logger.js';
import { authRouter } from './auth/routes.js';
import { healthRouter } from './routes/health.js';
import { scalesRouter } from './routes/scales.js';
import { storesRouter } from './routes/stores.js';
import { settingsRouter } from './routes/settings.js';
import { productsRouter } from './routes/products.js';
import path from 'node:path';
import { importRouter } from './routes/import.js';
import { imagesRouter } from './routes/images.js';
import { reportsRouter } from './routes/reports.js';
import { vncRouter } from './routes/vnc.js';
import ctrlAltdelRouter from './routes/ctrlAltdel.js';
import termAdminNovncRouter from './routes/termAdminNovnc.js';
import { erpPublicRouter, erpAdminRouter } from './routes/erp.js';
import { handleVncUpgrade } from './vnc/proxy.js';
import { startMirrorJobs } from './jobs/mirrorSync.js';
import { ensureSeedAdmin } from './db/users.js';
import { UpstreamError } from './upstream/termAdmin.js';
import { auditMiddleware } from './audit/middleware.js';
import { ZodError } from 'zod';
async function main() {
    await ensureSeedAdmin();
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', 'loopback');
    app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
    app.use(cors({
        origin: config.corsOrigin.split(',').map((s) => s.trim()),
        credentials: true,
    }));
    app.use((req, _res, next) => {
        const id = req.header('x-request-id') ?? uuidv4();
        req.headers['x-request-id'] = id;
        next();
    });
    app.use(pinoHttp({
        logger,
        customProps: (req) => ({ requestId: req.headers['x-request-id'] }),
        autoLogging: { ignore: (req) => req.url === '/api/health' },
    }));
    // ERP push público: se monta ANTES del json global de 4 MB y de
    // los routers con requireAuth, porque trae su propio body-parser
    // de 32 MB y autentica con API key, no con JWT.
    app.use('/api/erp', erpPublicRouter);
    const uploadsDir = path.resolve(process.cwd(), 'data', 'uploads');
    app.use('/uploads', express.static(uploadsDir));
    app.use(express.json({ limit: '32mb' }));
    app.use(express.urlencoded({ extended: false }));
    app.use(auditMiddleware);
    app.use('/api/auth', authRouter);
    app.use('/api', healthRouter);
    app.use('/api', scalesRouter);
    app.use('/api', storesRouter);
    app.use('/api', settingsRouter);
    app.use('/api', productsRouter);
    app.use('/api', importRouter);
    app.use('/api', imagesRouter);
    app.use('/api', reportsRouter);
    app.use('/api', vncRouter);
    app.use('/service/api', ctrlAltdelRouter);
    app.use('/service/api/term-admin', termAdminNovncRouter);
    app.use('/api/erp', erpAdminRouter);
    app.use((_req, res) => {
        res
            .status(404)
            .json({ ok: false, error: { code: 'NOT_FOUND', message: 'Endpoint no encontrado' } });
    });
    app.use((err, req, res, _next) => {
        const requestId = req.headers['x-request-id'];
        if (err instanceof UpstreamError) {
            logger.warn({ err: err.message, code: err.code, status: err.status, requestId }, 'Upstream error');
            res.status(err.status).json({
                ok: false,
                error: { code: err.code, message: err.message, requestId },
            });
            return;
        }
        if (err instanceof ZodError) {
            logger.warn({ issues: err.issues, requestId }, 'Validation error');
            res.status(400).json({
                ok: false,
                error: {
                    code: 'VALIDATION',
                    message: 'Datos inválidos',
                    details: err.flatten(),
                    requestId,
                },
            });
            return;
        }
        logger.error({ err, requestId }, 'Unhandled error');
        res.status(err.status ?? 500).json({
            ok: false,
            error: {
                code: err.code ?? 'INTERNAL',
                message: err.message ?? 'Error interno',
                requestId,
            },
        });
    });
    const server = app.listen(config.port, config.host, () => {
        logger.info({ host: config.host, port: config.port }, 'SDM API listening');
        startMirrorJobs();
    });
    server.on('upgrade', (req, socket, head) => {
        if (handleVncUpgrade(req, socket, head))
            return;
        socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
        socket.destroy();
    });
}
main().catch((err) => {
    logger.fatal({ err }, 'Fatal startup error');
    process.exit(1);
});
//# sourceMappingURL=server.js.map