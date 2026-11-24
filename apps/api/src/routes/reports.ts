import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  OrderFiltersSchema,
  type Order,
  type PagedResponse,
  type PanStatDay,
} from '@sdm/shared';
import { requireAuth } from '../auth/middleware.js';
import { termRequest } from '../upstream/termAdmin.js';
import { db } from '../db/client.js';

export const reportsRouter: Router = Router();
reportsRouter.use(requireAuth);

function buildQuery(filters: Record<string, unknown>): Record<string, string | number> {
  const q: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null || v === '') continue;
    q[k] = v as string | number;
  }
  return q;
}

reportsRouter.get('/orders', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = OrderFiltersSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: {
          code: 'VALIDATION',
          message: 'Filtros inválidos',
          details: parsed.error.flatten(),
        },
      });
      return;
    }
    const data = await termRequest<PagedResponse<Order>>('/api/termGoodsOrder', {
      query: buildQuery(parsed.data),
    });
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
});

reportsRouter.get('/orders/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = OrderFiltersSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: { code: 'VALIDATION', message: 'Filtros inválidos' },
      });
      return;
    }
    const f = parsed.data;
    const pageSize = 2000;
    const data = await termRequest<PagedResponse<Order>>('/api/termGoodsOrder', {
      query: buildQuery({ ...f, page: 0, size: pageSize }),
    });
    const allOrders = data.content;
    const cancelledOrders = allOrders.filter((o) => o.cancelFlag === 1);
    const validOrders = f.cancelFlag === 1
      ? cancelledOrders
      : allOrders.filter((o) => o.cancelFlag !== 1);

    const totalSales = validOrders.reduce((sum, o) => sum + Number(o.subtotal ?? 0), 0);
    const cancelledAmount = cancelledOrders.reduce((sum, o) => sum + Number(o.subtotal ?? 0), 0);
    const itemsCount = validOrders.length;
    const uniqueTickets = new Set(
      validOrders.map((o) => `${o.termId}-${o.orderTime?.slice(0, 10) ?? ''}-${o.daySeq ?? o.flowid ?? ''}`),
    ).size;
    const avgTicket = uniqueTickets > 0 ? totalSales / uniqueTickets : 0;

    const byDay = new Map<string, { date: string; sales: number; items: number }>();
    for (const o of validOrders) {
      const day = o.orderTime?.slice(0, 10) ?? 'sin-fecha';
      const row = byDay.get(day) ?? { date: day, sales: 0, items: 0 };
      row.sales += Number(o.subtotal ?? 0);
      row.items++;
      byDay.set(day, row);
    }
    const byDayArr = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));

    const byProduct = new Map<
      string,
      { goodsPlu: string; goodsName: string; sales: number; quantity: number }
    >();
    for (const o of validOrders) {
      const key = o.goodsPlu;
      const row = byProduct.get(key) ?? {
        goodsPlu: o.goodsPlu,
        goodsName: o.goodsName ?? '',
        sales: 0,
        quantity: 0,
      };
      row.sales += Number(o.subtotal ?? 0);
      row.quantity += Number(o.quantity ?? 0);
      byProduct.set(key, row);
    }
    const topProducts = [...byProduct.values()]
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 10);

    res.json({
      ok: true,
      data: {
        totalSales,
        itemsCount,
        ticketsCount: uniqueTickets,
        avgTicket,
        cancelledCount: cancelledOrders.length,
        cancelledAmount,
        byDay: byDayArr,
        topProducts,
        truncated: data.totalElements > pageSize,
        sampled: allOrders.length,
        totalAvailable: data.totalElements,
      },
    });
  } catch (err) {
    next(err);
  }
});

reportsRouter.get('/stats/daily', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const f = OrderFiltersSchema.partial().safeParse(req.query);
    const query: Record<string, string | number> = { page: 0, size: 500 };
    if (f.success) Object.assign(query, buildQuery(f.data));
    const data = await termRequest<PagedResponse<PanStatDay>>('/api/panStatisticDay', {
      query,
    });
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
});

reportsRouter.get('/audit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 100), 500);
    const rows = db
      .prepare<[number]>(
        "SELECT a.id, u.username, a.action, a.target, a.ip, a.request_id, a.created_at " +
          'FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ' +
          'ORDER BY a.id DESC LIMIT ?',
      )
      .all(limit);
    res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
});
