import { Router, type Request, type Response, type NextFunction } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { requireAuth } from '../auth/middleware.js';
import { logger } from '../logger.js';

export const imagesRouter: Router = Router();

const UPLOADS_DIR = path.resolve(process.cwd(), 'data', 'uploads', 'products');
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_BATCH_BYTES = 8 * 1024 * 1024;
const MAX_BATCH_ITEMS = 25;

class ImageValidationError extends Error {}

// Asegurar que el directorio de uploads exista
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const UploadItemSchema = z.object({
  name: z.string().min(1).max(255),
  data: z.string().min(1).max(7_100_000),
  size: z.number().optional(),
});

const UploadPayloadSchema = z.object({
  items: z.array(UploadItemSchema).min(1).max(MAX_BATCH_ITEMS),
});

function sanitizeFilename(originalName: string, extension: string, digest: string): string {
  const parsed = path.parse(originalName);
  // Normalizar nombre: quitar caracteres especiales y espacios raros
  const safeBase = parsed.name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Quitar acentos
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 80);

  return `${safeBase || 'prod'}-${digest}${extension}`;
}

function decodeImage(item: z.infer<typeof UploadItemSchema>): {
  buffer: Buffer;
  extension: string;
} {
  const base64 = item.data.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
  if (
    base64.length === 0 ||
    base64.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)
  ) {
    throw new ImageValidationError(`La imagen "${item.name}" no contiene Base64 válido.`);
  }
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
    throw new ImageValidationError(
      `La imagen "${item.name}" supera el máximo permitido de 5 MB o está vacía.`,
    );
  }
  if (item.size !== undefined && item.size !== buffer.length) {
    throw new ImageValidationError(`El tamaño declarado para "${item.name}" no coincide con su contenido.`);
  }

  const isPng = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isGif =
    buffer.length >= 6 &&
    (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' ||
      buffer.subarray(0, 6).toString('ascii') === 'GIF89a');
  const isBmp = buffer.length >= 2 && buffer.subarray(0, 2).toString('ascii') === 'BM';
  const isWebp =
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP';

  const extension = isPng
    ? '.png'
    : isJpeg
      ? '.jpg'
      : isGif
        ? '.gif'
        : isBmp
          ? '.bmp'
          : isWebp
            ? '.webp'
            : null;
  if (!extension) {
    throw new ImageValidationError(
      `El contenido de "${item.name}" no corresponde a una imagen compatible.`,
    );
  }
  return { buffer, extension };
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

    const prepared = parsed.data.items.map((item) => ({
      item,
      ...decodeImage(item),
    }));
    const totalBytes = prepared.reduce((sum, entry) => sum + entry.buffer.length, 0);
    if (totalBytes > MAX_BATCH_BYTES) {
      res.status(413).json({
        ok: false,
        error: { code: 'UPLOAD_TOO_LARGE', message: 'El lote de imágenes supera 8 MB.' },
      });
      return;
    }

    const results: { originalName: string; filename: string; path: string; url: string; size: number }[] = [];

    for (const { item, buffer, extension } of prepared) {
      const digest = createHash('sha256').update(buffer).digest('hex').slice(0, 12);
      const filename = sanitizeFilename(item.name, extension, digest);
      const filePath = path.join(UPLOADS_DIR, filename);
      const tempPath = `${filePath}.${randomUUID()}.tmp`;
      try {
        await fs.promises.writeFile(tempPath, buffer, { flag: 'wx' });
        await fs.promises.rename(tempPath, filePath);
      } catch (error) {
        await fs.promises.rm(tempPath, { force: true });
        throw error;
      }

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
    if (err instanceof ImageValidationError) {
      res.status(400).json({
        ok: false,
        error: { code: 'INVALID_IMAGE', message: err.message },
      });
      return;
    }
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
