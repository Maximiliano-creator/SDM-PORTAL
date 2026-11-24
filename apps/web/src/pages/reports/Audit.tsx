import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiClient } from '@/lib/queryClient';
import { downloadCsv } from '@/lib/csv';
import { toast } from 'sonner';

export function AuditReport() {
  const [search, setSearch] = useState('');
  const q = useQuery({
    queryKey: ['audit'],
    queryFn: async () => {
      const r = await apiClient.audit(500);
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

  const filtered = (q.data ?? []).filter((r) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      r.action.toLowerCase().includes(s) ||
      (r.username ?? '').toLowerCase().includes(s) ||
      (r.target ?? '').toLowerCase().includes(s) ||
      (r.ip ?? '').includes(s)
    );
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Auditoría local</CardTitle>
          <CardDescription>
            Registro de las últimas {q.data?.length ?? 0} operaciones realizadas en este portal.
            Solo se loggean operaciones de escritura (POST/PUT/DELETE).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Input
            placeholder="Buscar acción, usuario, IP…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
          <Button
            variant="outline"
            onClick={() => {
              if (filtered.length === 0) {
                toast.error('No hay filas para exportar');
                return;
              }
              downloadCsv(
                `auditoria_${new Date().toISOString().slice(0, 10)}.csv`,
                filtered.map((r) => ({
                  fecha: r.created_at,
                  usuario: r.username ?? '',
                  accion: r.action,
                  target: r.target ?? '',
                  ip: r.ip ?? '',
                  request_id: r.request_id ?? '',
                })),
              );
              toast.success(`${filtered.length} filas exportadas`);
            }}
          >
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        </CardContent>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Usuario</TableHead>
              <TableHead>Acción</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>IP</TableHead>
              <TableHead>Request ID</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && !q.isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  Sin registros.
                </TableCell>
              </TableRow>
            )}
            {filtered.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-xs">{r.created_at}</TableCell>
                <TableCell>{r.username ?? '—'}</TableCell>
                <TableCell className="font-mono text-xs">{r.action}</TableCell>
                <TableCell className="text-xs">{r.target ?? '—'}</TableCell>
                <TableCell className="font-mono text-xs">{r.ip ?? '—'}</TableCell>
                <TableCell className="font-mono text-xs">{r.request_id ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
