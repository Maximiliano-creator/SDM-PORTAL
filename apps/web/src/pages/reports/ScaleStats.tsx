import { useQuery } from '@tanstack/react-query';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiClient } from '@/lib/queryClient';
import { formatMoney } from '@/lib/date';

export function ScaleStatsReport() {
  const q = useQuery({
    queryKey: ['stats-daily'],
    queryFn: async () => {
      const r = await apiClient.statsDaily({});
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
  });

  if (q.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Error</CardTitle>
          <CardDescription>{(q.error as Error).message}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const rows = q.data?.content ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Estadísticas diarias por balanza</CardTitle>
        <CardDescription>
          Pesadas (sale) y reposiciones (restock) agregadas por día y producto.
        </CardDescription>
      </CardHeader>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
            <TableHead>Producto</TableHead>
            <TableHead className="text-right">Peso inicial</TableHead>
            <TableHead className="text-right">Peso final</TableHead>
            <TableHead className="text-right">Vendido</TableHead>
            <TableHead className="text-right">Repuesto</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && !q.isLoading && (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                Sin estadísticas registradas.
              </TableCell>
            </TableRow>
          )}
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="text-xs">{r.statisticDate}</TableCell>
              <TableCell>
                <div>{r.goodsName ?? r.goodCode}</div>
                <div className="text-xs text-muted-foreground">{r.goodCode}</div>
              </TableCell>
              <TableCell className="text-right font-mono">{formatMoney(r.weightValueBegin)}</TableCell>
              <TableCell className="text-right font-mono">{formatMoney(r.weightValueEnd)}</TableCell>
              <TableCell className="text-right font-mono">{formatMoney(r.weightValueSale)}</TableCell>
              <TableCell className="text-right font-mono">
                {formatMoney(r.weightValueRestock)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
