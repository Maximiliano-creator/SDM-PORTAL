import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, RefreshCw, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/queryClient';
import { cn } from '@/lib/utils';

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function OfflineBanner() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const r = await apiClient.health();
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const sync = useMutation({
    mutationFn: async () => {
      const r = await apiClient.mirrorSync();
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['health'] });
      qc.invalidateQueries({ queryKey: ['scales'] });
      qc.invalidateQueries({ queryKey: ['shops'] });
      toast.success('Sincronización completada');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!q.data) return null;
  const upstreamDown = q.data.upstream.termAdmin !== 'up';
  const mirror = q.data.mirror;
  const stale = mirror?.stale ?? false;
  if (!upstreamDown && !stale) return null;

  const worst = mirror?.datasets.reduce<{ age: number | null; dataset: string } | null>(
    (acc, d) => {
      if (d.ageSeconds == null) return acc;
      if (acc === null || d.ageSeconds > (acc.age ?? -1)) {
        return { age: d.ageSeconds, dataset: d.dataset };
      }
      return acc;
    },
    null,
  );

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 border-b px-6 py-2 text-sm',
        upstreamDown
          ? 'border-destructive/40 bg-destructive/10 text-destructive'
          : 'border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200',
      )}
    >
      <div className="flex items-center gap-2">
        {upstreamDown ? (
          <WifiOff className="h-4 w-4" />
        ) : (
          <AlertTriangle className="h-4 w-4" />
        )}
        <span>
          {upstreamDown ? (
            <>
              <strong>term_admin desconectado.</strong> Mostrando datos del último mirror
              {worst?.age != null && ` (hace ${formatAge(worst.age)})`}. Las escrituras pueden
              fallar hasta que vuelva.
            </>
          ) : (
            <>
              <strong>Mirror desactualizado.</strong> Último sync exitoso hace{' '}
              {worst?.age != null ? formatAge(worst.age) : '—'}.
            </>
          )}
        </span>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={() => sync.mutate()}
        disabled={sync.isPending}
      >
        {sync.isPending ? (
          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="mr-1 h-4 w-4" />
        )}
        Reintentar sync
      </Button>
    </div>
  );
}
