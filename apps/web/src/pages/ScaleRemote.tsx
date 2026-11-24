import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { VncViewerModal } from '@/components/vnc/VncViewerModal';
import { apiClient } from '@/lib/queryClient';

export function ScaleRemotePage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const termId = Number(id);

  const scaleQuery = useQuery({
    queryKey: ['scale', termId],
    queryFn: async () => {
      const r = await apiClient.scale(termId);
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    enabled: Number.isFinite(termId) && termId > 0,
  });

  const termName =
    searchParams.get('name') ||
    scaleQuery.data?.termName ||
    (Number.isFinite(termId) ? `Balanza #${termId}` : 'Balanza');

  if (!Number.isFinite(termId) || termId <= 0) {
    return (
      <div className="flex h-screen items-center justify-center bg-black text-white text-sm">
        ID de balanza inválido.
      </div>
    );
  }

  return (
    <VncViewerModal
      open={true}
      termId={termId}
      termName={termName}
      onOpenChange={(open) => {
        if (!open) {
          window.close();
          // Fallback si el navegador bloquea window.close()
          window.location.href = '/balanzas';
        }
      }}
    />
  );
}
