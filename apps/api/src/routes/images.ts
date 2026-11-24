import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { requireAuth } from '../auth/middleware.js';
import { logger } from '../logger.js';

export const imagesRouter: Router = Router();

const UPLOADS_DIR = path.resolve(process.cwd(), 'data', 'uploads', 'products');

// Asegurar que el directorio de uploads exista
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const UploadItemSchema = z.object({
  name: z.string().min(1).max(255),
  data: z.string().min(1), // Base64 data string (con o sin prefijo data:image/...)
  size: z.number().optional(),
});

const UploadPayloadSchema = z.object({
  items: z.array(UploadItemSchema).min(1).max(500),
});

function sanitizeFilename(originalName: string): string {
  const parsed = path.parse(originalName);
  const ext = parsed.ext.toLowerCase();
  const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'];
  const safeExt = allowedExts.includes(ext) ? ext : '.png';
  
  // Normalizar nombre: quitar caracteres especiales y espacios raros
  const safeBase = parsed.name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Quitar acentos
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 80);

  return `${safeBase || 'prod'}${safeExt}`;
}

imagesRouter.post('/products/images/upload', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = UploadPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: { code: 'VALIDATION', message: 'Payload de imágenes inválido', details: parsed.error.flatten() },
      });
      return;
    }

    const results: { originalName: string; filename: string; path: string; url: string; size: number }[] = [];

    for (const item of parsed.data.items) {
      const filename = sanitizeFilename(item.name);
      const filePath = path.join(UPLOADS_DIR, filename);

      // Extraer datos base64 quitando prefijo data:image/png;base64,
      const base64Data = item.data.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');

      await fs.promises.writeFile(filePath, buffer);

      const url = `/uploads/products/${filename}`;
      results.push({
        originalName: item.name,
        filename,
        path: url,
        url,
        size: buffer.length,
      });
    }

    logger.info({ count: results.length }, 'Product images uploaded successfully');

    res.json({
      ok: true,
      data: {
        total: results.length,
        items: results,
      },
    });
  } catch (err) {
    next(err);
  }
});

imagesRouter.get('/products/images', requireAuth, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    if (!fs.existsSync(UPLOADS_DIR)) {
      res.json({ ok: true, data: [] });
      return;
    }

    const files = await fs.promises.readdir(UPLOADS_DIR);
    const list = files
      .filter((f) => /\.(jpe?g|png|webp|bmp|gif)$/i.test(f))
      .map((filename) => ({
        filename,
        url: `/uploads/products/${filename}`,
      }));

    res.json({ ok: true, data: list });
  } catch (err) {
    next(err);
  }
});
