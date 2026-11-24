import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, MonitorPlay, Pencil, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiClient } from '@/lib/queryClient';
import { VncViewerModal } from '@/components/vnc/VncViewerModal';

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value || '—'}</div>
    </div>
  );
}

export function ScaleDetailPage() {
  const qc = useQueryClient();
  const { id } = useParams();
  const numericId = Number(id);
  const [vncOpen, setVncOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendTypes, setSendTypes] = useState<(0 | 1 | 2)[]>([0, 1, 2]);

  const [formState, setFormState] = useState({
    termName: '',
    shopId: 0,
    ipAddress: '',
    sequenceNo: '',
    scaleNum: '1',
    isMaster: true,
    distributeImmediately: true,
  });

  const q = useQuery({
    queryKey: ['scale', numericId],
    queryFn: async () => {
      const r = await apiClient.scale(numericId);
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    enabled: Number.isFinite(numericId),
  });

  const shopsQuery = useQuery({
    queryKey: ['shops'],
    queryFn: async () => {
      const r = await apiClient.shops();
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (opts: { distributeImmediately: boolean }) => {
      if (!q.data) return;
      const payload = {
        termName: formState.termName.trim(),
        shopId: formState.shopId || q.data.shopId,
        ipAddress: formState.ipAddress.trim(),
        sequenceNo: formState.sequenceNo.trim(),
        scaleNum: formState.scaleNum.trim() || '1',
        isMaster: formState.isMaster ? 1 : 0,
        distributeImmediately: opts.distributeImmediately,
        typeList: [0, 1, 2] as (0 | 1 | 2)[],
      };
      const r = await apiClient.updateScale(numericId, payload);
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    onSuccess: (data) => {
      setEditOpen(false);
      const res = data as {
        distributed?: boolean;
        verified?: boolean;
        previousIp?: string | null;
        appliedIp?: string | null;
      };
      const ipChanged = res.previousIp && res.appliedIp && res.previousIp !== res.appliedIp;
      const applied = res.appliedIp ? ` La IP quedó en ${res.appliedIp}.` : '';
      if (res.distributed) {
        toast.success(
          `Balanza actualizada y datos enviados al sistema.${applied}`,
          { description: ipChanged ? `IP anterior: ${res.previousIp}` : undefined },
        );
      } else {
        toast.success(`Balanza actualizada correctamente.${applied}`, {
          description: ipChanged ? `IP anterior: ${res.previousIp}` : undefined,
        });
      }
      qc.invalidateQueries({ queryKey: ['scale', numericId] });
      qc.invalidateQueries({ queryKey: ['scales'] });
    },
    onError: (err: Error) => {
      toast.error(err.message, { duration: 8000 });
    },
  });

  const distributeMutation = useMutation({
    mutationFn: async () => {
      const r = await apiClient.distributeScaleData({
        targetTermIdList: [numericId],
        typeList: sendTypes,
      });
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    onSuccess: () => {
      setSendOpen(false);
      toast.success('Datos enviados exitosamente a la balanza.');
      qc.invalidateQueries({ queryKey: ['scale', numericId] });
      qc.invalidateQueries({ queryKey: ['scales'] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  function startEdit() {
    if (!q.data) return;
    setFormState({
      termName: q.data.termName ?? '',
      shopId: q.data.shopId,
      ipAddress: q.data.ipAddress ?? '',
      sequenceNo: q.data.sequenceNo ?? q.data.boardSn ?? '',
      scaleNum: q.data.scaleNum ?? '1',
      isMaster: q.data.isMaster === 1 || q.data.isMaster === true,
      distributeImmediately: true,
    });
    setEditOpen(true);
  }

  function toggleSendType(val: 0 | 1 | 2) {
    setSendTypes((prev) =>
      prev.includes(val) ? prev.filter((x) => x !== val) : [...prev, val],
    );
  }

  if (q.isLoading) return <div>Cargando…</div>;
  if (q.isError)
    return (
      <Card>
        <CardHeader>
          <CardTitle>Error</CardTitle>
          <CardDescription>{(q.error as Error).message}</CardDescription>
        </CardHeader>
      </Card>
    );
  if (!q.data) return null;

  const s = q.data;
  const online = s.onlineStatus === 1;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-3">
        <Link to="/balanzas">
          <ArrowLeft className="h-4 w-4" /> Volver
        </Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{s.termName}</h2>
          <p className="text-sm text-muted-foreground">ID {s.termId} · {s.ipAddress}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={startEdit}>
            <Pencil className="mr-1.5 h-4 w-4" /> Editar Balanza
          </Button>
          <Button size="sm" variant="default" onClick={() => setSendOpen(true)}>
            <Send className="mr-1.5 h-4 w-4" /> Enviar Datos
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setVncOpen(true)}
            disabled={!s.ipAddress}
            title={
              !s.ipAddress
                ? 'Sin IP registrada'
                : online
                ? 'Abrir control remoto VNC'
                : 'Abrir control remoto VNC (el heartbeat de term_admin figura offline, pero el portal verifica el puerto en tiempo real)'
            }
          >
            <MonitorPlay className="mr-1.5 h-4 w-4" /> Control remoto
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const url = `${window.location.origin}/balanzas/${s.termId}/remoto?name=${encodeURIComponent(
                s.termName ?? '',
              )}`;
              window.open(url, '_blank');
            }}
            disabled={!s.ipAddress}
            title={
              !s.ipAddress
                ? 'Sin IP registrada'
                : 'Abrir el control remoto en una pestaña nueva'
            }
          >
            <MonitorPlay className="mr-1.5 h-4 w-4" /> Control remoto (Nueva Pestaña)
          </Button>
          <Badge variant={online ? 'success' : 'destructive'}>{online ? 'Online' : 'Offline'}</Badge>
        </div>
      </div>

      <VncViewerModal
        open={vncOpen}
        onOpenChange={setVncOpen}
        termId={s.termId}
        termName={s.termName ?? `Balanza ${s.termId}`}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Identidad</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <Field label="Nombre" value={s.termName} />
            <Field label="ID" value={s.termId} />
            <Field label="Tienda" value={s.shopName ? `${s.shopName} (#${s.shopId})` : s.shopId} />
            <Field label="Tipo" value={s.termType} />
            <Field label="Marca" value={s.brand} />
            <Field label="Modelo" value={s.model} />
            <Field label="Serial" value={s.sequenceNo ?? s.boardSn} />
            <Field label="Versión" value={s.version} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Red</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <Field label="IP" value={<span className="font-mono">{s.ipAddress}</span>} />
            <Field label="MAC" value={<span className="font-mono">{s.macAddr}</span>} />
            <Field label="Máscara" value={s.netmask} />
            <Field label="Gateway" value={s.gateway} />
          </CardContent>
        </Card>
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Telemetría</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Field label="Estado" value={s.termStatus ? 'Activo' : 'Inactivo'} />
            <Field label="Binding" value={s.bindingStatus === 1 ? 'Atado' : 'Sin atar'} />
            <Field label="Última comunicación" value={s.lastCommunicationTime} />
            <Field label="Último sync productos" value={s.lastSyncTermGoodsTime} />
            <Field label="Es master" value={s.isMaster === 1 || s.isMaster === true ? 'Sí' : 'No'} />
            <Field label="Creado" value={s.createTime} />
            <Field label="Actualizado" value={s.updateTime} />
          </CardContent>
        </Card>
      </div>

      {/* Diálogo de Edición */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Balanza #{s.termId}</DialogTitle>
            <DialogDescription>
              Actualiza la dirección IP, nombre de dispositivo o tienda asociada.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>Nombre del dispositivo</Label>
              <Input
                value={formState.termName}
                onChange={(e) => setFormState({ ...formState, termName: e.target.value })}
                placeholder="Ej. Balanza1"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Tienda</Label>
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={formState.shopId}
                onChange={(e) => setFormState({ ...formState, shopId: Number(e.target.value) })}
              >
                {(shopsQuery.data ?? []).map((sh) => (
                  <option key={sh.shopId} value={sh.shopId}>
                    {sh.shopName}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Dirección IP</Label>
                <Input
                  value={formState.ipAddress}
                  onChange={(e) => setFormState({ ...formState, ipAddress: e.target.value })}
                  placeholder="192.168.1.147"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>N° de Serie</Label>
                <Input
                  value={formState.sequenceNo}
                  onChange={(e) => setFormState({ ...formState, sequenceNo: e.target.value })}
                  placeholder="260514000005"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <input
                id="detailIsMaster"
                type="checkbox"
                checked={formState.isMaster}
                onChange={(e) => setFormState({ ...formState, isMaster: e.target.checked })}
              />
              <Label htmlFor="detailIsMaster">Balanza Principal (Master)</Label>
            </div>

            <div className="rounded-md border p-3 bg-muted/20 space-y-2 mt-2">
              <div className="flex items-center gap-2">
                <input
                  id="detailDistribute"
                  type="checkbox"
                  checked={formState.distributeImmediately}
                  onChange={(e) =>
                    setFormState({ ...formState, distributeImmediately: e.target.checked })
                  }
                />
                <Label htmlFor="detailDistribute" className="font-medium cursor-pointer text-sm">
                  Enviar datos a la balanza inmediatamente al guardar
                </Label>
              </div>
              <p className="text-xs text-muted-foreground pl-6">
                Sincroniza catálogo, precios y configuración con la nueva IP.
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="secondary"
              disabled={updateMutation.isPending || !formState.termName || !formState.ipAddress}
              onClick={() => updateMutation.mutate({ distributeImmediately: false })}
            >
              Solo Guardar
            </Button>
            <Button
              disabled={updateMutation.isPending || !formState.termName || !formState.ipAddress}
              onClick={() => updateMutation.mutate({ distributeImmediately: true })}
            >
              <Send className="mr-1.5 h-4 w-4" />
              {updateMutation.isPending ? 'Guardando y Enviando…' : 'Guardar y Enviar Datos'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo de Envío Directo */}
      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar Datos a {s.termName}</DialogTitle>
            <DialogDescription>
              Selecciona qué paquetes de información transmitir a la balanza ({s.ipAddress}).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={sendTypes.includes(0)}
                onChange={() => toggleSendType(0)}
              />
              Catálogo completo de productos (Tipo 0)
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={sendTypes.includes(1)}
                onChange={() => toggleSendType(1)}
              />
              Actualización de precios y etiquetas (Tipo 1)
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={sendTypes.includes(2)}
                onChange={() => toggleSendType(2)}
              />
              Imágenes y configuración (Tipo 2)
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={distributeMutation.isPending || sendTypes.length === 0}
              onClick={() => distributeMutation.mutate()}
            >
              <Send className="mr-1.5 h-4 w-4" />
              {distributeMutation.isPending ? 'Enviando…' : 'Enviar ahora'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
