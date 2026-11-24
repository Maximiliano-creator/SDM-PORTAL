import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import RFB from '@novnc/novnc';
import {
  AlertCircle,
  Camera,
  Loader2,
  Maximize2,
  Minimize2,
  Palette,
  RefreshCw,
  X,
} from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { apiClient } from '@/lib/queryClient';
import { cn } from '@/lib/utils';

interface VncViewerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  termId: number;
  termName: string;
}

type VncStatus = 'idle' | 'connecting' | 'connected' | 'closed' | 'error';

export function VncViewerModal({ open, onOpenChange, termId, termName }: VncViewerModalProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80" />
        <DialogPrimitive.Content className="fixed inset-0 z-50 flex flex-col bg-black">
          {open && (
            <VncViewerInner
              termId={termId}
              termName={termName}
              onClose={() => onOpenChange(false)}
            />
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function VncViewerInner({
  termId,
  termName,
  onClose,
}: {
  termId: number;
  termName: string;
  onClose: () => void;
}) {
  const screenRef = useRef<HTMLDivElement | null>(null);
  const rfbRef = useRef<InstanceType<typeof RFB> | null>(null);
  const [status, setStatus] = useState<VncStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [ip, setIp] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [swapRB, setSwapRB] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const stored = window.localStorage.getItem(`sdm-portal-vnc-swap-${termId}`);
    if (stored === null) return true;
    return stored === '1';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(`sdm-portal-vnc-swap-${termId}`, swapRB ? '1' : '0');
  }, [termId, swapRB]);

  useEffect(() => {
    let cancelled = false;
    let rfb: InstanceType<typeof RFB> | null = null;

    async function connect() {
      setStatus('connecting');
      setError(null);
      const ticketRes = await apiClient.vncTicket(termId);
      if (cancelled) return;
      if (!ticketRes.ok) {
        setError(ticketRes.error.message);
        setStatus('error');
        return;
      }
      setIp(ticketRes.data.ip);

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${window.location.host}${ticketRes.data.wsPath}`;

      if (!screenRef.current) return;
      try {
        rfb = new RFB(screenRef.current, wsUrl, {
          shared: true,
          wsProtocols: ['binary'],
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
        return;
      }
      rfb.viewOnly = false;
      rfb.scaleViewport = true;
      rfb.resizeSession = false;
      rfb.background = '#000';

      rfb.addEventListener('connect', () => {
        if (cancelled) return;
        setStatus('connected');
        toast.success(`VNC conectado a ${termName}`);
      });
      rfb.addEventListener('disconnect', (e: CustomEvent<{ clean: boolean }>) => {
        if (cancelled) return;
        setStatus('closed');
        if (!e.detail?.clean) {
          setError('Conexión interrumpida');
        }
      });
      rfb.addEventListener('securityfailure', (e: CustomEvent<{ reason: string }>) => {
        if (cancelled) return;
        setError(`Fallo de seguridad VNC: ${e.detail?.reason ?? 'desconocido'}`);
        setStatus('error');
      });

      rfbRef.current = rfb;
    }

    connect();
    return () => {
      cancelled = true;
      if (rfbRef.current) {
        try {
          rfbRef.current.disconnect();
        } catch {
          /* ignore */
        }
        rfbRef.current = null;
      }
    };
  }, [termId, termName, attempt]);

  useEffect(() => {
    function onFsChange() {
      setFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  function reconnect() {
    if (rfbRef.current) {
      try {
        rfbRef.current.disconnect();
      } catch {
        /* ignore */
      }
      rfbRef.current = null;
    }
    setAttempt((n) => n + 1);
  }

  async function toggleFullscreen() {
    if (!screenRef.current) return;
    if (!document.fullscreenElement) {
      await screenRef.current.requestFullscreen().catch(() => {});
    } else {
      await document.exitFullscreen().catch(() => {});
    }
  }

  function screenshot() {
    const canvas = screenRef.current?.querySelector('canvas');
    if (!canvas) {
      toast.error('No hay imagen para capturar todavía');
      return;
    }
    const saveBlob = (blob: Blob | null) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, '-')
        .slice(0, 19);
      a.download = `vnc-${termName.replace(/[^a-z0-9-_]/gi, '_')}-${stamp}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5_000);
    };
    if (!swapRB) {
      canvas.toBlob(saveBlob);
      return;
    }
    // Aplicar el swap R↔B a los píxeles antes de exportar la PNG
    const off = document.createElement('canvas');
    off.width = canvas.width;
    off.height = canvas.height;
    const ctx = off.getContext('2d');
    if (!ctx) {
      canvas.toBlob(saveBlob);
      return;
    }
    ctx.drawImage(canvas, 0, 0);
    const img = ctx.getImageData(0, 0, off.width, off.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] as number;
      d[i] = d[i + 2] as number;
      d[i + 2] = r;
    }
    ctx.putImageData(img, 0, 0);
    off.toBlob(saveBlob);
  }

  return (
    <>
      <header className="flex h-14 items-center justify-between border-b border-white/10 bg-black/90 px-4 text-white">
        <div className="flex items-center gap-3">
          <DialogPrimitive.Title className="text-sm font-semibold">
            {termName}
          </DialogPrimitive.Title>
          {ip && <span className="text-xs font-mono text-white/60">{ip}</span>}
          <StatusBadge status={status} />
        </div>
        <DialogPrimitive.Description className="sr-only">
          Control remoto VNC de la balanza
        </DialogPrimitive.Description>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={reconnect}
            className="text-white hover:bg-white/10"
            disabled={status === 'connecting'}
          >
            <RefreshCw className="mr-1 h-4 w-4" /> Reconectar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={screenshot}
            className="text-white hover:bg-white/10"
            disabled={status !== 'connected'}
          >
            <Camera className="mr-1 h-4 w-4" /> Captura
          </Button>
          <Button
            size="sm"
            variant={swapRB ? 'secondary' : 'ghost'}
            onClick={() => setSwapRB((v) => !v)}
            className={swapRB ? '' : 'text-white hover:bg-white/10'}
            title="Si los colores se ven con tinte (rojo o azul) intercambiá los canales R↔B"
          >
            <Palette className="mr-1 h-4 w-4" /> R↔B
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={toggleFullscreen}
            className="text-white hover:bg-white/10"
          >
            {fullscreen ? (
              <Minimize2 className="mr-1 h-4 w-4" />
            ) : (
              <Maximize2 className="mr-1 h-4 w-4" />
            )}
            {fullscreen ? 'Salir' : 'Pantalla completa'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onClose}
            className="text-white hover:bg-white/10"
          >
            <X className="mr-1 h-4 w-4" /> Cerrar
          </Button>
        </div>
      </header>

      <svg width="0" height="0" className="absolute" aria-hidden="true">
        <filter id="sdm-vnc-swap-rb" colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values="0 0 1 0 0
                    0 1 0 0 0
                    1 0 0 0 0
                    0 0 0 1 0"
          />
        </filter>
      </svg>

      <div className="relative flex-1 bg-black">
        <div
          ref={screenRef}
          style={swapRB ? { filter: 'url(#sdm-vnc-swap-rb)' } : undefined}
          className={cn(
            'absolute inset-0',
            status === 'connected' ? 'opacity-100' : 'opacity-30',
          )}
        />
        {status !== 'connected' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-white">
            {status === 'connecting' && (
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Conectando a {ip ?? termName}…
              </div>
            )}
            {status === 'error' && (
              <div className="pointer-events-auto flex max-w-md flex-col items-center gap-3 rounded-lg border border-red-500/40 bg-red-950/70 p-6 text-center text-sm">
                <AlertCircle className="h-6 w-6 text-red-400" />
                <div>
                  <div className="font-medium text-red-100">No se pudo abrir VNC</div>
                  <div className="mt-1 text-red-200/80">{error ?? 'Error desconocido'}</div>
                </div>
                <Button size="sm" variant="secondary" onClick={reconnect}>
                  Reintentar
                </Button>
              </div>
            )}
            {status === 'closed' && (
              <div className="pointer-events-auto flex flex-col items-center gap-3 rounded-lg bg-white/5 p-6 text-sm">
                <div>Sesión cerrada{error ? ` — ${error}` : ''}.</div>
                <Button size="sm" variant="secondary" onClick={reconnect}>
                  Volver a conectar
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <footer className="flex h-8 items-center justify-between border-t border-white/10 bg-black/90 px-4 text-xs text-white/50">
        <span>VNC vía websockify · Timeout de inactividad: 5 min</span>
        <span>Click + teclado se envían a la balanza</span>
      </footer>
    </>
  );
}

function StatusBadge({ status }: { status: VncStatus }) {
  if (status === 'connected') {
    return <Badge variant="success">Conectado</Badge>;
  }
  if (status === 'connecting') {
    return <Badge variant="secondary">Conectando…</Badge>;
  }
  if (status === 'error') {
    return <Badge variant="destructive">Error</Badge>;
  }
  if (status === 'closed') {
    return <Badge variant="secondary">Desconectado</Badge>;
  }
  return null;
}
