import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Package,
  Receipt,
  Scale as ScaleIcon,
  Store,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiClient } from '@/lib/queryClient';
import { formatMoney, fromInputDate, toLocalDate } from '@/lib/date';

function KpiCard({
  title,
  value,
  caption,
  icon: Icon,
  to,
}: {
  title: string;
  value: React.ReactNode;
  caption?: string;
  icon: React.ComponentType<{ className?: string }>;
  to?: string;
}) {
  const inner = (
    <Card className={to ? 'transition-colors hover:border-primary/50' : undefined}>
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardDescription className="font-medium">{title}</CardDescription>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold tracking-tight">{value}</div>
        {caption && <p className="mt-1 text-xs text-muted-foreground">{caption}</p>}
      </CardContent>
    </Card>
  );

  return to ? (
    <Link to={to} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function DashboardPage() {
  const todayStr = toLocalDate(new Date());
  const todayRange = useMemo(
    () => ({
      startTime: fromInputDate(todayStr, 'start'),
      endTime: fromInputDate(todayStr, 'end'),
    }),
    [todayStr],
  );

  const health = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const r = await apiClient.health();
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    refetchInterval: 15_000,
  });

  const upstreamUp = health.data?.upstream.termAdmin === 'up';

  const scales = useQuery({
    queryKey: ['scales'],
    queryFn: async () => {
      const r = await apiClient.scales();
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    refetchInterval: 30_000,
    enabled: upstreamUp,
  });

  const shops = useQuery({
    queryKey: ['shops'],
    queryFn: async () => {
      const r = await apiClient.shops();
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    enabled: upstreamUp,
  });

  const products = useQuery({
    queryKey: ['products-count'],
    queryFn: async () => {
      const r = await apiClient.products({ page: 0, size: 1 });
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    enabled: upstreamUp,
  });

  const todaySummary = useQuery({
    queryKey: ['orders-summary-today', todayRange],
    queryFn: async () => {
      const r = await apiClient.ordersSummary(todayRange);
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    refetchInterval: 30_000,
    enabled: upstreamUp,
  });

  const recentOrders = useQuery({
    queryKey: ['orders-recent-today', todayRange],
    queryFn: async () => {
      const r = await apiClient.orders({ ...todayRange, page: 0, size: 6 });
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    refetchInterval: 30_000,
    enabled: upstreamUp,
  });

  const scaleList = scales.data ?? [];
  const onlineCount = scaleList.filter((s) => s.onlineStatus === 1).length;
  const totalScales = scaleList.length;
  const offlineCount = totalScales - onlineCount;
  const totalShops = shops.data?.length ?? 0;
  const totalProducts = products.data?.totalElements;

  const salesToday = todaySummary.data?.totalSales ?? 0;
  const ticketsToday = todaySummary.data?.ticketsCount ?? 0;
  const avgTicketToday = todaySummary.data?.avgTicket ?? 0;
  const topProductsToday = (todaySummary.data?.topProducts ?? []).slice(0, 5);
  const latestOrders = (recentOrders.data?.content ?? []).filter((o) => o.cancelFlag !== 1).slice(0, 5);

  const mirrorInfo = health.data?.mirror;
  const maxMirrorAge = useMemo(() => {
    if (!mirrorInfo?.datasets?.length) return null;
    const ages = mirrorInfo.datasets
      .map((d) => d.ageSeconds)
      .filter((a): a is number => typeof a === 'number');
    return ages.length > 0 ? Math.max(...ages) : null;
  }, [mirrorInfo]);

  return (
    <div className="space-y-6">
      {/* Encabezado y acciones rápidas */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Panel general</h2>
          <p className="text-sm text-muted-foreground">
            Estado operativo de balanzas, catálogo y ventas del día ({todayStr}).
          </p>
        </div>
      </div>

      {/* Alerta solo si hay caída de comunicación */}
      {!upstreamUp && health.data && (
        <Card className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4" />
              Sin conexión con el servidor de balanzas
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-amber-900 dark:text-amber-200">
            No se pudo contactar al servicio de balanzas ({health.data.upstream.termAdminError ?? 'sin respuesta'}). Verifica que el servicio esté iniciado o revisa{' '}
            <Link to="/configuracion" className="underline font-medium">
              Configuración
            </Link>
            .
          </CardContent>
        </Card>
      )}

      {/* 4 KPIs principales en CLP y datos en vivo */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Ventas de hoy"
          icon={Receipt}
          to="/reportes/ventas"
          value={todaySummary.isLoading ? '…' : `$${formatMoney(salesToday)}`}
          caption={
            ticketsToday > 0
              ? `${ticketsToday} ticket(s) · Promedio $${formatMoney(avgTicketToday)}`
              : 'Sin ventas registradas hoy'
          }
        />
        <KpiCard
          title="Balanzas en línea"
          icon={ScaleIcon}
          to="/balanzas"
          value={scales.isLoading ? '…' : `${onlineCount} / ${totalScales}`}
          caption={
            totalScales === 0
              ? 'Sin balanzas registradas'
              : offlineCount === 0
                ? 'Todas las balanzas conectadas'
                : `${offlineCount} balanza(s) sin conexión`
          }
        />
        <KpiCard
          title="Productos en catálogo"
          icon={Package}
          to="/catalogo"
          value={products.isLoading ? '…' : (totalProducts ?? '—')}
          caption="PLUs disponibles para balanzas"
        />
        <KpiCard
          title="Tiendas activas"
          icon={Store}
          to="/balanzas"
          value={shops.isLoading ? '…' : totalShops}
          caption="Sucursales vinculadas al sistema"
        />
      </div>

      {/* Estado por balanza */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Estado de balanzas</CardTitle>
            <CardDescription>
              Conexión en tiempo real y última sincronización de precios por equipo.
            </CardDescription>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/balanzas">
              Ver todas <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Balanza</TableHead>
              <TableHead>Tienda</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Dirección IP</TableHead>
              <TableHead>Última sinc. catálogo</TableHead>
              <TableHead className="text-right">Acción</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {scaleList.length === 0 && !scales.isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                  No hay balanzas vinculadas.
                </TableCell>
              </TableRow>
            )}
            {scaleList.map((sc) => {
              const online = sc.onlineStatus === 1;
              return (
                <TableRow key={sc.termId}>
                  <TableCell className="font-medium">{sc.termName}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {sc.shopName ?? `Tienda ${sc.shopId}`}
                  </TableCell>
                  <TableCell>
                    {online ? (
                      <Badge variant="success">En línea</Badge>
                    ) : (
                      <Badge variant="destructive">Desconectada</Badge>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{sc.ipAddress}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {sc.lastSyncTermGoodsTime ?? 'Pendiente'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="outline" size="sm">
                      <Link to="/catalogo/importar">Sincronizar</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {/* Actividad de hoy: Top productos y Últimas pesadas */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Más vendidos hoy</CardTitle>
              <CardDescription>Top 5 productos por monto vendido</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="/reportes/ventas">
                Reportes <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {topProductsToday.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Aún no hay ventas registradas hoy.
              </p>
            ) : (
              <div className="space-y-3">
                {topProductsToday.map((p, idx) => (
                  <div
                    key={p.goodsPlu}
                    className="flex items-center justify-between border-b pb-2 last:border-b-0 last:pb-0 text-sm"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                        {idx + 1}
                      </span>
                      <div>
                        <div className="font-medium">{p.goodsName || `PLU ${p.goodsPlu}`}</div>
                        <div className="text-xs text-muted-foreground">
                          PLU {p.goodsPlu} · {Number(p.quantity.toFixed(3))} un/kg
                        </div>
                      </div>
                    </div>
                    <div className="font-mono font-semibold">${formatMoney(p.sales)}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Últimas pesadas y ventas</CardTitle>
              <CardDescription>Registros recientes recibidos desde balanza</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="/reportes/ventas">
                Ver detalle <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {latestOrders.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                En espera de tickets desde la balanza.
              </p>
            ) : (
              <div className="space-y-3">
                {latestOrders.map((o, i) => (
                  <div
                    key={`${o.termId}-${o.flowid ?? i}`}
                    className="flex items-center justify-between border-b pb-2 last:border-b-0 last:pb-0 text-sm"
                  >
                    <div>
                      <div className="font-medium">{o.goodsName ?? `PLU ${o.goodsPlu}`}</div>
                      <div className="text-xs text-muted-foreground">
                        {o.orderTime?.slice(11, 16) ?? '—'} · {o.quantity ?? 0} {o.unit ?? ''}
                        {o.daySeq ? ` · Ticket #${o.daySeq}` : ''}
                      </div>
                    </div>
                    <div className="font-mono font-semibold">${formatMoney(o.subtotal)}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Estado de servicios en lenguaje claro para el cliente */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Estado del servicio</CardTitle>
          <CardDescription>Disponibilidad de los componentes del sistema</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Portal de gestión</div>
              <div className="text-xs text-muted-foreground">Base de datos local y panel web</div>
            </div>
            <Badge variant={health.data?.status === 'up' ? 'success' : 'warning'} className="gap-1">
              <CheckCircle2 className="h-3 w-3" />
              {health.data?.status === 'up' ? 'Operativo' : 'Degradado'}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Comunicación con balanzas</div>
              <div className="text-xs text-muted-foreground">
                {upstreamUp
                  ? `Conectado${health.data?.upstream.termAdminVersion ? ` · Versión ${health.data.upstream.termAdminVersion}` : ''}`
                  : 'Sin respuesta del servicio'}
              </div>
            </div>
            <Badge variant={upstreamUp ? 'success' : 'destructive'} className="gap-1">
              {upstreamUp ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
              {upstreamUp ? 'Conectado' : 'Desconectado'}
            </Badge>
          </div>
          {maxMirrorAge !== null && (
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Respaldo de datos</div>
                <div className="text-xs text-muted-foreground">
                  Última actualización hace {maxMirrorAge}s
                </div>
              </div>
              <Badge variant={mirrorInfo?.stale ? 'warning' : 'outline'}>
                {mirrorInfo?.stale ? 'Desactualizado' : 'Al día'}
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
