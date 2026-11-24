import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Download, Info, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import type { Scale, Shop } from '@sdm/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiClient } from '@/lib/queryClient';
import { daysAgo, fromInputDate, toLocalDate, formatMoney } from '@/lib/date';
import { downloadCsv } from '@/lib/csv';

export function SalesReport() {
  const navigate = useNavigate();
  const [startDate, setStartDate] = useState(toLocalDate(daysAgo(30)));
  const [endDate, setEndDate] = useState(toLocalDate(new Date()));
  const [shopId, setShopId] = useState<string>('');
  const [termId, setTermId] = useState<string>('');
  const [cancelFilter, setCancelFilter] = useState<string>('');
  const [page, setPage] = useState(0);
  const pageSize = 25;

  const filters = useMemo(
    () => ({
      startTime: fromInputDate(startDate, 'start'),
      endTime: fromInputDate(endDate, 'end'),
      shopId: shopId ? Number(shopId) : undefined,
      termId: termId ? Number(termId) : undefined,
      cancelFlag: cancelFilter !== '' ? Number(cancelFilter) : undefined,
    }),
    [startDate, endDate, shopId, termId, cancelFilter],
  );

  const shopsQuery = useQuery({
    queryKey: ['shops'],
    queryFn: async () => {
      const r = await apiClient.shops();
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
  });

  const scalesQuery = useQuery({
    queryKey: ['scales'],
    queryFn: async () => {
      const r = await apiClient.scales();
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
  });

  const summaryQuery = useQuery({
    queryKey: ['orders-summary', filters],
    queryFn: async () => {
      const r = await apiClient.ordersSummary(filters);
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
  });

  const ordersQuery = useQuery({
    queryKey: ['orders', filters, page],
    queryFn: async () => {
      const r = await apiClient.orders({ ...filters, page, size: pageSize });
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    placeholderData: (prev) => prev,
  });

  const filteredScales = useMemo(() => {
    const all = scalesQuery.data ?? [];
    if (!shopId) return all;
    return all.filter((sc: Scale) => sc.shopId === Number(shopId));
  }, [scalesQuery.data, shopId]);

  const scaleMap = useMemo(() => {
    const m = new Map<number, Scale>();
    for (const sc of scalesQuery.data ?? []) m.set(sc.termId, sc);
    return m;
  }, [scalesQuery.data]);

  async function exportCsv() {
    try {
      const r = await apiClient.orders({ ...filters, page: 0, size: 2000 });
      if (!r.ok) throw new Error(r.error.message);
      const orders = r.data.content;
      if (orders.length === 0) {
        toast.error('No hay órdenes para exportar');
        return;
      }
      downloadCsv(
        `ventas_${startDate}_${endDate}.csv`,
        orders.map((o) => ({
          fecha: o.orderTime ?? '',
          ticket: o.daySeq ?? '',
          plu: o.goodsPlu,
          producto: o.goodsName ?? '',
          unidad: o.unit ?? '',
          precio_unitario: o.price ?? 0,
          cantidad: o.quantity ?? 0,
          subtotal: o.subtotal ?? 0,
          operario: o.operName ?? '',
          balanza: scaleMap.get(o.termId)?.termName ?? scaleMap.get(o.termId)?.sequenceNo ?? o.termId,
          cancelado: o.cancelFlag === 1 ? 'sí' : 'no',
        })),
      );
      toast.success(`Exportadas ${orders.length} orden(es)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo exportar CSV');
    }
  }

  const s = summaryQuery.data as
    | (NonNullable<typeof summaryQuery.data> & {
        cancelledCount?: number;
        cancelledAmount?: number;
      })
    | undefined;
  const rows = ordersQuery.data?.content ?? [];
  const totalOrders = ordersQuery.data?.totalElements ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalOrders / pageSize));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-6">
          <div className="space-y-2">
            <Label htmlFor="start">Desde</Label>
            <Input
              id="start"
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPage(0);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="end">Hasta</Label>
            <Input
              id="end"
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPage(0);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="shop">Tienda</Label>
            <select
              id="shop"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={shopId}
              onChange={(e) => {
                setShopId(e.target.value);
                setTermId('');
                setPage(0);
              }}
            >
              <option value="">Todas</option>
              {(shopsQuery.data ?? []).map((shop: Shop) => (
                <option key={shop.shopId} value={shop.shopId}>
                  {shop.shopName}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="scale">Balanza</Label>
            <select
              id="scale"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={termId}
              onChange={(e) => {
                setTermId(e.target.value);
                setPage(0);
              }}
            >
              <option value="">Todas</option>
              {filteredScales.map((sc: Scale) => (
                <option key={sc.termId} value={sc.termId}>
                  {sc.termName || sc.sequenceNo || `Balanza #${sc.termId}`}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="status">Estado</Label>
            <select
              id="status"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={cancelFilter}
              onChange={(e) => {
                setCancelFilter(e.target.value);
                setPage(0);
              }}
            >
              <option value="">Todos</option>
              <option value="0">Solo válidos</option>
              <option value="1">Solo cancelados</option>
            </select>
          </div>
          <div className="flex items-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                summaryQuery.refetch();
                ordersQuery.refetch();
              }}
            >
              <RefreshCw className="h-4 w-4" /> Refrescar
            </Button>
            <Button onClick={exportCsv} disabled={totalOrders === 0}>
              <Download className="h-4 w-4" /> Export CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      {summaryQuery.isError && (
        <Card>
          <CardHeader>
            <CardTitle>Error</CardTitle>
            <CardDescription>{(summaryQuery.error as Error).message}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {!summaryQuery.isLoading && !summaryQuery.isError && totalOrders === 0 && (
        <Card className="border-blue-500/30 bg-blue-50/50 dark:bg-blue-950/20">
          <CardContent className="flex items-center gap-3 py-3 text-xs text-muted-foreground">
            <Info className="h-4 w-4 shrink-0 text-blue-600" />
            <span>
              Conexión activa con <strong>term_admin</strong>, pero no hay tickets registrados en este rango. Cuando actives el guardado de ventas en la balanza, las pesadas y boletas aparecerán aquí automáticamente al presionar <strong>Refrescar</strong>.
            </span>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Ventas totales</CardDescription>
            <CardTitle className="text-3xl">
              {s ? `$${formatMoney(s.totalSales)}` : '—'}
            </CardTitle>
            {s && (s.cancelledCount ?? 0) > 0 && (
              <p className="text-xs text-muted-foreground">
                Excluye {s.cancelledCount} anulado(s) (${formatMoney(s.cancelledAmount ?? 0)})
              </p>
            )}
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Tickets</CardDescription>
            <CardTitle className="text-3xl">{s?.ticketsCount ?? '—'}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Ticket promedio</CardDescription>
            <CardTitle className="text-3xl">
              {s ? `$${formatMoney(s.avgTicket)}` : '—'}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Ítems vendidos</CardDescription>
            <CardTitle className="text-3xl">{s?.itemsCount ?? '—'}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {s?.truncated && (
        <Card className="border-amber-500/40 bg-amber-50 dark:bg-amber-950/30">
          <CardContent className="py-3 text-xs">
            Mostrando los primeros {s.sampled} ítems de {s.totalAvailable}. Para mayor detalle, acota el rango de fechas o filtra por tienda/balanza.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ventas por día</CardTitle>
          </CardHeader>
          <CardContent style={{ height: 280 }}>
            {s && s.byDay.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={s.byDay}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(v: number) => `$${formatMoney(v)}`}
                    contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="sales"
                    name="Ventas"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Sin datos en el rango.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top 10 productos</CardTitle>
          </CardHeader>
          <CardContent style={{ height: 280 }}>
            {s && s.topProducts.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={s.topProducts} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="goodsName" tick={{ fontSize: 11 }} width={120} />
                  <Tooltip
                    formatter={(v: number) => `$${formatMoney(v)}`}
                    contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                  />
                  <Bar dataKey="sales" name="Ventas" fill="hsl(var(--primary))" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Sin productos vendidos.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Últimas órdenes</CardTitle>
            <CardDescription>
              {totalOrders} registro(s) · página {page + 1} de {totalPages}
            </CardDescription>
          </div>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Ticket</TableHead>
              <TableHead>Balanza</TableHead>
              <TableHead>Producto</TableHead>
              <TableHead className="text-right">Cantidad</TableHead>
              <TableHead className="text-right">Subtotal</TableHead>
              <TableHead>Operario</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && !ordersQuery.isLoading && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  No hay órdenes en este rango.
                </TableCell>
              </TableRow>
            )}
            {rows.map((o, i) => (
              <TableRow key={`${o.termId}-${o.flowid ?? i}`}>
                <TableCell className="text-xs">{o.orderTime ?? '—'}</TableCell>
                <TableCell className="font-mono text-xs">{o.daySeq ?? '—'}</TableCell>
                <TableCell className="text-xs">
                  {scaleMap.get(o.termId)?.termName ?? scaleMap.get(o.termId)?.sequenceNo ?? o.termId}
                </TableCell>
                <TableCell>
                  <div>{o.goodsName ?? o.goodsPlu}</div>
                  <div className="text-xs text-muted-foreground">PLU {o.goodsPlu}</div>
                </TableCell>
                <TableCell className="text-right font-mono">
                  {o.quantity ?? 0} {o.unit ?? ''}
                </TableCell>
                <TableCell className="text-right font-mono">${formatMoney(o.subtotal)}</TableCell>
                <TableCell>{o.operName ?? '—'}</TableCell>
                <TableCell>
                  {o.cancelFlag === 1 ? (
                    <Badge variant="destructive">Cancelado</Badge>
                  ) : (
                    <Badge variant="success">OK</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between border-t p-3 text-sm">
          <span className="text-xs text-muted-foreground">
            Mostrando {rows.length} de {totalOrders}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0 || ordersQuery.isFetching}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Anterior
            </Button>
            <span className="text-xs text-muted-foreground">
              Página {page + 1} de {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1 || ordersQuery.isFetching}
              onClick={() => setPage((p) => p + 1)}
            >
              Siguiente
            </Button>
          </div>
        </div>
      </Card>

      <div className="text-xs text-muted-foreground">
        Tip: para registros de auditoría del portal navega a{' '}
        <button
          className="underline"
          onClick={() => navigate('/reportes/auditoria')}
        >
          auditoría
        </button>
        .
      </div>
    </div>
  );
}
