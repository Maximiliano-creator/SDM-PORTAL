import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { termRequest, UpstreamError } from '../upstream/termAdmin.js';
import { getMirrorScales, getMirrorShops, upsertScales, upsertShops } from '../db/mirror.js';
import { getSetting } from '../db/settings.js';
import { isFresh, serveWithMirror } from './helpers/mirrorServe.js';
import { db } from '../db/client.js';
import { isValidIp } from '../upstream/websockify.js';
import { normalizeDistributionTypes } from '../upstream/distribution.js';
import type { Scale, Shop } from '@sdm/shared';

export const scalesRouter: Router = Router();

scalesRouter.use(requireAuth);

const DistributeDataSchema = z.object({
  shopId: z.number().int().optional(),
  targetTermIdList: z.array(z.number().int()).min(1, 'Seleccioná al menos una balanza'),
  typeList: z
    .array(z.union([z.literal(0), z.literal(1), z.literal(2)]))
    .min(1, 'Seleccioná al menos un tipo de dato a enviar'),
});

const IpSchema = z
  .string()
  .trim()
  .min(1, 'La dirección IP es obligatoria')
  .refine((v) => isValidIp(v), 'La dirección IP no es válida (se espera IPv4, ej. 192.168.1.30)');

/**
 * term_admin expone la balanza como una entidad completa (`TermInfo`) y su
 * `update()` hace un copy() con `ignoreNullValue`, es decir: los campos que
 * llegan en null se conservan de la base, el resto se sobreescribe. Por eso
 * hay que mandar la entidad completa (la que devuelve `/api/termInfo/all`) y no
 * sólo los campos editados.
 */
const ScaleUpsertSchema = z.object({
  termName: z.string().trim().min(1, 'El nombre es obligatorio').max(20),
  shopId: z.number().int(),
  ipAddress: IpSchema,
  sequenceNo: z.string().trim().max(20).optional(),
  scaleNum: z.string().trim().max(50).optional(),
  isMaster: z.union([z.boolean(), z.number().int()]).optional(),
  distributeImmediately: z.boolean().optional(),
  typeList: z.array(z.union([z.literal(0), z.literal(1), z.literal(2)])).optional(),
});

const DiscoverSchema = z.object({
  subnet: z
    .string()
    .trim()
    .regex(/^\d{1,3}(\.\d{1,3}){0,3}$/, 'La subred debe ser IPv4, ej. 192.168.1'),
});

/**
 * Lee el inventario vivo de term_admin. Si el upstream no responde se cae al
 * espejo local para que el panel siga siendo usable en modo degradado.
 */
async function fetchLiveScales(): Promise<{ scales: Scale[]; live: boolean }> {
  try {
    const live = await termRequest<Scale[]>('/api/termInfo/all');
    if (Array.isArray(live)) {
      upsertScales(live);
      return { scales: live, live: true };
    }
  } catch {
    /* caemos al espejo */
  }
  return { scales: getMirrorScales().data, live: false };
}


scalesRouter.get('/scales', async (_req: Request, res: Response, next: NextFunction) => {
  const result = await serveWithMirror<Scale[]>(res, {
    fresh: true,
    getMirror: () => getMirrorScales(),
    fetchLive: async () => {
      const cached = getMirrorScales().data;
      if (cached.length > 0) {
        await Promise.allSettled(
          cached.map((s) => termRequest(`/api/termInfo/getOnlineStatus/${s.termId}`)),
        );
      }
      const live = await termRequest<Scale[]>('/api/termInfo/all');
      upsertScales(live);
      return live;
    },
  });
  if ('error' in result) {
    next(result.error);
    return;
  }
  res.json({ ok: true, data: result.data });
});

scalesRouter.get('/scales/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({
        ok: false,
        error: { code: 'BAD_ID', message: 'id de balanza inválido' },
      });
      return;
    }
    const result = await serveWithMirror<Scale[]>(res, {
      fresh: isFresh(req.query),
      getMirror: () => getMirrorScales(),
      fetchLive: async () => {
        const live = await termRequest<Scale[]>('/api/termInfo/all');
        upsertScales(live);
        return live;
      },
    });
    if ('error' in result) {
      next(result.error);
      return;
    }
    const scale = result.data.find((s) => s.termId === id);
    if (!scale) {
      res
        .status(404)
        .json({ ok: false, error: { code: 'NOT_FOUND', message: 'Balanza no encontrada' } });
      return;
    }
    res.json({ ok: true, data: scale });
  } catch (err) {
    next(err);
  }
});

scalesRouter.post('/scales', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = ScaleUpsertSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: {
          code: 'VALIDATION',
          message: parsed.error.issues[0]?.message ?? 'Datos de la balanza inválidos',
          details: parsed.error.flatten(),
        },
      });
      return;
    }
    const { distributeImmediately, typeList, ...scaleUpdates } = parsed.data;

    // term_admin crea la balanza a partir de la entidad `TermInfo`. Las columnas
    // NOT NULL que el servicio no calcula se completan acá.
    const payload = {
      termName: scaleUpdates.termName,
      shopId: scaleUpdates.shopId,
      ipAddress: scaleUpdates.ipAddress,
      sequenceNo: scaleUpdates.sequenceNo ?? '',
      scaleNum: scaleUpdates.scaleNum ?? '1',
      isMaster: scaleUpdates.isMaster === true || scaleUpdates.isMaster === 1,
      termStatus: true,
      termType: '1',
      bindingStatus: 1,
      onlineStatus: 0,
      deptCodeList: '',
      groupIdList: '',
      brand: '',
      model: '',
      boardSn: '',
      netmask: '',
      gateway: '',
      macAddr: '',
    };

    // Ruta real de alta en term_admin: POST /api/termInfo (no existe /add).
    const upstreamResult = await termRequest<unknown>('/api/termInfo', {
      method: 'POST',
      body: payload,
    });

    const { scales } = await fetchLiveScales();
    const created = scales.find(
      (s) => s.termName === payload.termName && s.ipAddress === payload.ipAddress,
    );

    db.prepare(
      "INSERT INTO audit_log (user_id, action, target, ip, payload) VALUES (?, 'CREATE_SCALE', ?, ?, ?)",
    ).run(
      req.user!.sub,
      String(created?.termId ?? payload.termName),
      req.ip ?? null,
      JSON.stringify({ termName: payload.termName, ipAddress: payload.ipAddress }),
    );

    res.json({ ok: true, data: { scale: created ?? null, upstreamResult } });
  } catch (err) {
    next(err);
  }
});

scalesRouter.put('/scales/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const termId = Number(req.params.id);
    if (!Number.isFinite(termId)) {
      res.status(400).json({ ok: false, error: { code: 'BAD_ID', message: 'ID de balanza inválido' } });
      return;
    }

    const parsed = ScaleUpsertSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: {
          code: 'VALIDATION',
          message: parsed.error.issues[0]?.message ?? 'Datos de la balanza inválidos',
          details: parsed.error.flatten(),
        },
      });
      return;
    }
    const { distributeImmediately, typeList, ...scaleUpdates } = parsed.data;

    // 1) Estado actual en term_admin (fuente de verdad). `current` trae todos los
    //    campos de hardware que el formulario no expone y hay que preservar.
    const before = await fetchLiveScales();
    const current = before.scales.find((s) => s.termId === termId);
    if (!current) {
      res.status(404).json({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Balanza no encontrada en term_admin' },
      });
      return;
    }
    const previousIp = current.ipAddress ?? null;

    // 2) Payload completo: term_admin ignora los nulls, así que hay que enviar la
    //    entidad entera con los campos editados encima.
    const merged = { ...current, ...scaleUpdates, termId };

    // 3) ESCRITURA REAL. El endpoint de actualización de term_admin es
    //    PUT /api/termInfo; POST /api/termInfo/update devuelve 404 y por eso el
    //    cambio de IP nunca se aplicaba.
    const upstreamResult = await termRequest<unknown>('/api/termInfo', {
      method: 'PUT',
      body: merged,
    });

    // 4) VERIFICACIÓN: releemos el upstream y comparamos. Si term_admin acepta
    //    la operación pero no aplica el valor, hay que decirlo en lugar de
    //    reportar un éxito falso.
    const after = await fetchLiveScales();
    if (!after.live) {
      res.status(503).json({
        ok: false,
        error: {
          code: 'UPSTREAM_UNREACHABLE',
          message:
            'La balanza se actualizó en term_admin pero no se pudo verificar (term_admin no responde).',
        },
      });
      return;
    }
    const applied = after.scales.find((s) => s.termId === termId);
    const appliedIp = applied?.ipAddress ?? null;
    const verified = appliedIp === merged.ipAddress;

    db.prepare(
      "INSERT INTO audit_log (user_id, action, target, ip, payload) VALUES (?, 'UPDATE_SCALE', ?, ?, ?)",
    ).run(
      req.user!.sub,
      String(termId),
      req.ip ?? null,
      JSON.stringify({
        termId,
        termName: merged.termName,
        previousIp,
        appliedIp,
        verified,
        distributeImmediately,
      }),
    );

    if (!verified) {
      res.status(502).json({
        ok: false,
        error: {
          code: 'UPSTREAM_NOT_APPLIED',
          message:
            `term_admin aceptó la operación pero la IP no quedó aplicada ` +
            `(sigue en ${appliedIp ?? 'desconocida'}, se envió ${merged.ipAddress}).`,
        },
        data: { scale: applied ?? null, verified: false, previousIp, appliedIp },
      });
      return;
    }

    // 5) Distribución de datos: sólo después de confirmar la IP, para que el
    //    envío apunte a la balanza con la dirección correcta.
    let distributeResult: unknown = null;
    let distributed = false;
    if (distributeImmediately) {
      const types = normalizeDistributionTypes(
        Array.isArray(typeList) && typeList.length > 0 ? typeList : [0, 1, 2],
      );
      try {
        distributeResult = await termRequest<unknown>('/api/termInfo/distributeData', {
          method: 'POST',
          body: {
            shopId: merged.shopId ?? -1,
            targetTermIdList: [termId],
            typeList: types,
          },
        });
        distributed = true;
        db.prepare(
          "INSERT INTO audit_log (user_id, action, target, ip, payload) VALUES (?, 'DISTRIBUTE_DATA', ?, ?, ?)",
        ).run(
          req.user!.sub,
          String(termId),
          req.ip ?? null,
          JSON.stringify({ termId, typeList: types, triggeredBy: 'UPDATE_SCALE' }),
        );
      } catch (distErr) {
        distributeResult = { error: distErr instanceof Error ? distErr.message : String(distErr) };
      }
    }

    res.json({
      ok: true,
      data: {
        scale: applied,
        upstreamResult,
        distributed,
        distributeResult,
        verified,
        previousIp,
        appliedIp,
      },
    });
  } catch (err) {
    next(err);
  }
});

scalesRouter.delete('/scales/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const termId = Number(req.params.id);
    // term_admin borra con DELETE /api/termInfo y el id en el body como array.
    const upstreamResult = await termRequest<unknown>('/api/termInfo', {
      method: 'DELETE',
      body: [termId],
    });
    db.prepare('DELETE FROM mirror_scales WHERE term_id = ?').run(termId);
    res.json({ ok: true, data: upstreamResult });
  } catch (err) {
    next(err);
  }
});

scalesRouter.post('/scales/discover', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = DiscoverSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: {
          code: 'VALIDATION',
          message: parsed.error.issues[0]?.message ?? 'Subred inválida',
          details: parsed.error.flatten(),
        },
      });
      return;
    }
    const subnet = parsed.data.subnet;

    // term_admin escanea la subred de forma asíncrona: se dispara el barrido y
    // después se consulta el resultado cacheado.
    await termRequest(`/api/termInfo/scannerTermIp/${encodeURIComponent(subnet)}`, {
      method: 'GET',
    });

    let finished = false;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      finished = await termRequest<boolean>('/api/termInfo/isTermIpFindFinish');
      if (finished) break;
    }

    const found = await termRequest<unknown[]>('/api/termInfo/queryScannerTermIpListFromCache');
    res.json({
      ok: true,
      data: { subnet, finished, items: Array.isArray(found) ? found : [] },
    });
  } catch (err) {
    next(err);
  }
});


scalesRouter.post('/scales/distribute', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = DistributeDataSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: {
          code: 'VALIDATION',
          message: parsed.error.issues[0]?.message ?? 'Parámetros de envío inválidos',
          details: parsed.error.flatten(),
        },
      });
      return;
    }

    const payload = {
      shopId: parsed.data.shopId ?? -1,
      targetTermIdList: parsed.data.targetTermIdList,
      typeList: normalizeDistributionTypes(parsed.data.typeList),
    };

    const upstreamResult = await termRequest<unknown>('/api/termInfo/distributeData', {
      method: 'POST',
      body: payload,
    });

    db.prepare(
      "INSERT INTO audit_log (user_id, action, target, ip, payload) VALUES (?, 'DISTRIBUTE_DATA', ?, ?, ?)",
    ).run(
      req.user!.sub,
      payload.targetTermIdList.join(','),
      req.ip ?? null,
      JSON.stringify(payload),
    );

    res.json({
      ok: true,
      data: {
        sent: true,
        targetTermIdList: payload.targetTermIdList,
        typeList: payload.typeList,
        upstreamResult,
      },
    });
  } catch (err) {
    next(err);
  }
});

scalesRouter.get('/shops', async (req: Request, res: Response, next: NextFunction) => {
  const result = await serveWithMirror<Shop[]>(res, {
    fresh: isFresh(req.query),
    getMirror: () => getMirrorShops(),
    fetchLive: async () => {
      const rawLive = await termRequest<(Shop & { deleteFlag?: number })[]>('/api/shopInfo/all');
      const live = rawLive
        .filter((s) => s.deleteFlag !== 1)
        .map((s) => {
          const localPhone = getSetting(`shop.${s.shopId}.phone`);
          return localPhone !== null ? { ...s, directorPhone: localPhone } : s;
        });
      upsertShops(live);
      return live;
    },
  });
  if ('error' in result) {
    next(result.error);
    return;
  }
  res.json({ ok: true, data: result.data });
});

scalesRouter.post('/scales/:id/check-status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const termId = Number(req.params.id);
    const statusRes = await termRequest<unknown>(`/api/termInfo/getOnlineStatus/${termId}`);
    const live = await termRequest<Scale[]>('/api/termInfo/all');
    upsertScales(live);
    const updated = live.find((s) => s.termId === termId) ?? null;
    res.json({ ok: true, data: { statusRes, scale: updated } });
  } catch (err) {
    next(err);
  }
});

export function isUpstreamError(err: unknown): err is UpstreamError {
  return err instanceof UpstreamError;
}
