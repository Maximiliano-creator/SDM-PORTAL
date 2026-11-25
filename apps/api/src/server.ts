import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import type { IncomingMessage } from 'node:http';
import { v4 as uuidv4 } from 'uuid';
import { config } from './config.js';
import { logger } from './logger.js';
import { authRouter } from './auth/routes.js';
import { healthRouter } from './routes/health.js';
import { scalesRouter } from './routes/scales.js';
import { storesRouter } from './routes/stores.js';
import { settingsRouter } from './routes/settings.js';
import { productsRouter } from './routes/products.js';
import { productGroupsRouter } from './routes/productGroups.js';
import path from 'node:path';
import { importRouter } from './routes/import.js';
import { imagesRouter } from './routes/images.js';
import { reportsRouter } from './routes/reports.js';
import { vncRouter } from './routes/vnc.js';
import ctrlAltdelRouter from './routes/ctrlAltdel.js';
import termAdminNovncRouter from './routes/termAdminNovnc.js';
import { erpPublicRouter, erpAdminRouter } from './routes/erp.js';
import { closeVncConnections, handleVncUpgrade } from './vnc/proxy.js';
import { startMirrorJobs, stopMirrorJobs } from './jobs/mirrorSync.js';
import { ensureSeedAdmin } from './db/users.js';
import { db } from './db/client.js';
import { UpstreamError } from './upstream/termAdmin.js';
import { auditMiddleware } from './audit/middleware.js';
import { ZodError } from 'zod';

async function main() {
  await ensureSeedAdmin();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: config.corsOrigin.split(',').map((s) => s.trim()),
      credentials: true,
    }),
  );

  app.use((req, _res, next) => {
    const id = req.header('x-request-id') ?? uuidv4();
    req.headers['x-request-id'] = id;
    next();
  });
  app.use(
    pinoHttp({
      logger,
      customProps: (req) => ({ requestId: req.headers['x-request-id'] }),
      serializers: {
        req: (req: IncomingMessage) => ({
          method: req.method,
          url: new URL(req.url ?? '/', 'http://localhost').pathname,
          remoteAddress: req.socket?.remoteAddress ?? null,
        }),
      },
      autoLogging: { ignore: (req) => req.url === '/api/health' },
    }),
  );

  // La API ERP valida la API key antes de parsear cuerpos grandes.
  app.use('/api/erp', erpPublicRouter);

  const uploadsDir = path.resolve(process.cwd(), 'data', 'uploads');
  app.use('/uploads', express.static(uploadsDir));

  app.use(express.json({ limit: '12mb' }));
  app.use(express.urlencoded({ extended: false }));

  app.use(auditMiddleware);

  app.use('/api/auth', authRouter);
  app.use('/api', healthRouter);
  app.use('/api', scalesRouter);
  app.use('/api', storesRouter);
  app.use('/api', settingsRouter);
  app.use('/api', productsRouter);
  app.use('/api', productGroupsRouter);
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

  app.use(
    (
      err: Error & { status?: number; code?: string },
      req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const requestId = req.headers['x-request-id'] as string | undefined;
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
      const status = err.status ?? 500;
      res.status(status).json({
        ok: false,
        error: {
          code: err.code ?? 'INTERNAL',
          message: status >= 500 ? 'Error interno del servidor' : err.message,
          requestId,
        },
      });
    },
  );

  const server = app.listen(config.port, config.host, () => {
    logger.info({ host: config.host, port: config.port }, 'SDM API listening');
    startMirrorJobs();
  });

  server.on('upgrade', (req, socket, head) => {
    if (handleVncUpgrade(req, socket, head)) return;
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    socket.destroy();
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'SDM API shutting down');
    stopMirrorJobs();
    closeVncConnections();
    const forceClose = setTimeout(() => {
      logger.error('Graceful shutdown timed out; closing remaining connections');
      server.closeAllConnections();
      db.close();
      process.exit(1);
    }, 10_000);
    server.close((err) => {
      clearTimeout(forceClose);
      if (err) {
        logger.error({ err }, 'Error closing HTTP server');
        process.exitCode = 1;
      }
      db.close();
    });
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Fatal startup error');
  process.exit(1);
});
