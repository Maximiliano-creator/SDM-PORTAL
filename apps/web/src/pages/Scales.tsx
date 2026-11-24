import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  MonitorPlay,
  Pencil,
  Plus,
  Radar,
  RefreshCw,
  Search,
  Send,
  Trash2,
} from 'lucide-react';
import type { Scale, Shop } from '@sdm/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { VncViewerModal } from '@/components/vnc/VncViewerModal';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiClient } from '@/lib/queryClient';

function checkOnline(scale: Scale): boolean {
  return scale.onlineStatus === 1;
}

function statusBadge(scale: Scale) {
  const online = checkOnline(scale);
  return (
    <Badge variant={online ? 'success' : 'destructive'}>
      {online ? 'En línea' : 'Fuera de línea'}
    </Badge>
  );
}

interface ScaleFormState {
  termId?: number;
  termName: string;
  shopId: number;
  ipAddress: string;
  sequenceNo: string;
  scaleNum: string;
  isMaster: boolean;
  distributeImmediately?: boolean;
  typeList?: (0 | 1 | 2)[];
}

export function ScalesPage() {
  const qc = useQueryClient();
  const scalesQuery = useQuery({
    queryKey: ['scales'],
    queryFn: async () => {
      const r = await apiClient.scales();
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    refetchInterval: 10_000,
  });
  const shopsQuery = useQuery({
    queryKey: ['shops'],
    queryFn: async () => {
      const r = await apiClient.shops();
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
  });

  const [search, setSearch] = useState('');
  const [shopFilter, setShopFilter] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [vncTarget, setVncTarget] = useState<{ id: number; name: string } | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [formState, setFormState] = useState<ScaleFormState>({
    termName: '',
    shopId: 0,
    ipAddress: '',
    sequenceNo: '',
    scaleNum: '1',
    isMaster: true,
  });

  const [sendOpen, setSendOpen] = useState(false);
  const [sendTypes, setSendTypes] = useState<(0 | 1 | 2)[]>([0, 1, 2]);

  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [discoveredList, setDiscoveredList] = useState<Record<string, unknown>[]>([]);

  const shopMap = useMemo(() => {
    const m = new Map<number, Shop>();
    for (const s of shopsQuery.data ?? []) m.set(s.shopId, s);
    return m;
  }, [shopsQuery.data]);

  const filtered = useMemo(() => {
    const all = scalesQuery.data ?? [];
    const q = search.trim().toLowerCase();
    return all.filter((s) => {
      if (shopFilter && String(s.shopId) !== shopFilter) return false;
      if (!q) return true;
      return (
        s.termName?.toLowerCase().includes(q) ||
        s.ipAddress?.toLowerCase().includes(q) ||
        s.sequenceNo?.toLowerCase().includes(q) ||
        s.boardSn?.toLowerCase().includes(q) ||
        String(s.termId).includes(q)
      );
    });
  }, [scalesQuery.data, search, shopFilter]);

  const saveMutation = useMutation({
    mutationFn: async (data: ScaleFormState) => {
      const payload = {
        termName: data.termName.trim(),
        shopId: data.shopId || (shopsQuery.data?.[0]?.shopId ?? 1),
        ipAddress: data.ipAddress.trim(),
        sequenceNo: data.sequenceNo.trim(),
        scaleNum: data.scaleNum.trim() || '1',
        isMaster: data.isMaster ? 1 : 0,
        distributeImmediately: data.distributeImmediately ?? false,
        typeList: data.typeList ?? [0, 1, 2],
      };
      const r = data.termId
        ? await apiClient.updateScale(data.termId, payload)
        : await apiClient.createScale(payload);
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    onSuccess: (data: unknown) => {
      setFormOpen(false);
      const res = data as { distributed?: boolean };
      if (res?.distributed) {
        setFeedback({
          type: 'ok',
          text: 'Balanza guardada y datos de catálogo/configuración enviados al sistema exitosamente.',
        });
      } else {
        setFeedback({ type: 'ok', text: 'Balanza guardada correctamente en el sistema.' });
      }
      qc.invalidateQueries({ queryKey: ['scales'] });
    },
    onError: (err: Error) => {
      setFeedback({ type: 'err', text: err.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      for (const id of ids) {
        const r = await apiClient.deleteScale(id);
        if (!r.ok) throw new Error(r.error.message);
      }
    },
    onSuccess: () => {
      setSelectedIds([]);
      setFeedback({ type: 'ok', text: 'Balanza(s) eliminada(s).' });
      qc.invalidateQueries({ queryKey: ['scales'] });
    },
    onError: (err: Error) => {
      setFeedback({ type: 'err', text: err.message });
    },
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const r = await apiClient.distributeScaleData({
        targetTermIdList: selectedIds,
        typeList: sendTypes,
      });
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    onSuccess: () => {
      setSendOpen(false);
      setFeedback({
        type: 'ok',
        text: 'Datos enviados a ' + selectedIds.length + ' balanza(s).',
      });
      qc.invalidateQueries({ queryKey: ['scales'] });
    },
    onError: (err: Error) => {
      setFeedback({ type: 'err', text: err.message });
    },
  });

  const checkStatusMutation = useMutation({
    mutationFn: async (termId: number) => {
      const r = await apiClient.checkScaleStatus(termId);
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scales'] });
    },
  });

  const discoverMutation = useMutation({
    mutationFn: async () => {
      const r = await apiClient.discoverScales();
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    onSuccess: (data) => {
      const items = Array.isArray(data)
        ? (data as Record<string, unknown>[])
        : Array.isArray((data as { list?: unknown[] })?.list)
          ? ((data as { list: Record<string, unknown>[] }).list)
          : [];
      setDiscoveredList(items);
      setDiscoverOpen(true);
    },
    onError: (err: Error) => {
      setFeedback({ type: 'err', text: 'Error al buscar en red: ' + err.message });
    },
  });

  function openCreate() {
    setFormState({
      termName: '',
      shopId: shopsQuery.data?.[0]?.shopId ?? 3,
      ipAddress: '',
      sequenceNo: '',
      scaleNum: '1',
      isMaster: true,
      distributeImmediately: true,
      typeList: [0, 1, 2],
    });
    setFormOpen(true);
  }

  function openEdit(s: Scale) {
    setFormState({
      termId: s.termId,
      termName: s.termName ?? '',
      shopId: s.shopId,
      ipAddress: s.ipAddress ?? '',
      sequenceNo: s.sequenceNo ?? s.boardSn ?? '',
      scaleNum: s.scaleNum ?? '1',
      isMaster: s.isMaster === 1 || s.isMaster === true,
      distributeImmediately: true,
      typeList: [0, 1, 2],
    });
    setFormOpen(true);
  }

  function toggleSelect(id: number) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleSelectAll() {
    if (selectedIds.length === filtered.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filtered.map((s) => s.termId));
    }
  }

  function toggleSendType(val: 0 | 1 | 2) {
    setSendTypes((prev) =>
      prev.includes(val) ? prev.filter((x) => x !== val) : [...prev, val],
    );
  }

  if (scalesQuery.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Error</CardTitle>
          <CardDescription>{(scalesQuery.error as Error).message}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Verificá la conexión a term_admin en{' '}
            <Link className="underline" to="/configuracion">
              Configuración
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    );
  }

  const total = filtered.length;
  const onlineCount = filtered.filter(checkOnline).length;
  const alertClass =
    feedback?.type === 'ok'
      ? 'flex items-center justify-between rounded-md border px-4 py-2 text-sm border-emerald-500/30 bg-emerald-500/10 text-emerald-700'
      : 'flex items-center justify-between rounded-md border px-4 py-2 text-sm border-destructive/30 bg-destructive/10 text-destructive';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Gestión de Balanzas</h2>
          <p className="text-sm text-muted-foreground">
            {scalesQuery.isLoading
              ? 'Cargando…'
              : total + ' balanza(s) listada(s) · ' + onlineCount + ' en línea'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1.5 h-4 w-4" /> Nueva
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={selectedIds.length !== 1}
            onClick={() => {
              const target = filtered.find((s) => s.termId === selectedIds[0]);
              if (target) openEdit(target);
            }}
          >
            <Pencil className="mr-1.5 h-4 w-4" /> Editar
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={selectedIds.length === 0 || deleteMutation.isPending}
            onClick={() => {
              if (confirm('¿Eliminar ' + selectedIds.length + ' balanza(s) seleccionada(s)?')) {
                deleteMutation.mutate(selectedIds);
              }
            }}
          >
            <Trash2 className="mr-1.5 h-4 w-4" /> Borrar
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={discoverMutation.isPending}
            onClick={() => discoverMutation.mutate()}
          >
            <Radar className="mr-1.5 h-4 w-4" />
            {discoverMutation.isPending ? 'Buscando…' : 'Buscar Balanza'}
          </Button>
          <Button
            size="sm"
            variant="default"
            disabled={selectedIds.length === 0}
            onClick={() => setSendOpen(true)}
          >
            <Send className="mr-1.5 h-4 w-4" /> Enviar Datos ({selectedIds.length})
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={scalesQuery.isFetching}
            onClick={() => scalesQuery.refetch()}
            title="Sincronizar ahora"
          >
            <RefreshCw className={scalesQuery.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          </Button>
        </div>
      </div>

      {feedback && (
        <div className={alertClass}>
          <span>{feedback.text}</span>
          <button className="text-xs underline" onClick={() => setFeedback(null)}>
            Cerrar
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, IP, serial…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 w-80"
          />
        </div>
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={shopFilter}
          onChange={(e) => setShopFilter(e.target.value)}
        >
          <option value="">Todas las tiendas</option>
          {(shopsQuery.data ?? []).map((s) => (
            <option key={s.shopId} value={s.shopId}>
              {s.shopName}
            </option>
          ))}
        </select>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && selectedIds.length === filtered.length}
                  onChange={toggleSelectAll}
                />
              </TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>Tienda</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Principal</TableHead>
              <TableHead>N° de Serie</TableHead>
              <TableHead>Dirección IP</TableHead>
              <TableHead>Versión</TableHead>
              <TableHead>Entrega Incremental / Completa</TableHead>
              <TableHead>Módulo IA</TableHead>
              <TableHead className="text-right">Operación</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && !scalesQuery.isLoading && (
              <TableRow>
                <TableCell colSpan={11} className="text-center text-sm text-muted-foreground py-8">
                  Sin resultados.
                </TableCell>
              </TableRow>
            )}
            {filtered.map((s) => {
              const isOnline = checkOnline(s);
              return (
                <TableRow key={s.termId}>
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(s.termId)}
                      onChange={() => toggleSelect(s.termId)}
                    />
                  </TableCell>
                  <TableCell>
                    <Link to={'/balanzas/' + s.termId} className="font-medium hover:underline">
                      {s.termName}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      ID {s.termId} · {s.bindingStatus === 1 ? 'Atado' : 'Sin atar'}
                    </div>
                  </TableCell>
                  <TableCell>{shopMap.get(s.shopId)?.shopName ?? '#' + s.shopId}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      {statusBadge(s)}
                      <button
                        type="button"
                        onClick={() => checkStatusMutation.mutate(s.termId)}
                        disabled={checkStatusMutation.isPending}
                        title="Comprobar estado en línea ahora"
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <RefreshCw
                          className={
                            checkStatusMutation.isPending && checkStatusMutation.variables === s.termId
                              ? 'h-3.5 w-3.5 animate-spin'
                              : 'h-3.5 w-3.5'
                          }
                        />
                      </button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {s.isMaster === 1 || s.isMaster === true ? 'Sí' : 'No'}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {s.sequenceNo ?? s.boardSn ?? '—'}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{s.ipAddress}</TableCell>
                  <TableCell className="font-mono text-xs">{s.version ?? '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <div>Inc: {s.incGoodsIssueTime ?? '—'}</div>
                    <div>Comp: {s.completeGoodsIssueTime ?? '—'}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {s.aiSn ?? '—'}
                    {s.aiClientId ? (
                      <div className="text-[11px] text-muted-foreground">ID IA: {s.aiClientId}</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!isOnline || !s.ipAddress}
                        onClick={() =>
                          setVncTarget({ id: s.termId, name: s.termName ?? 'Balanza ' + s.termId })
                        }
                        title={
                          !isOnline
                            ? 'Balanza fuera de línea'
                            : !s.ipAddress
                              ? 'Sin IP'
                              : 'Control remoto VNC'
                        }
                      >
                        <MonitorPlay className="mr-1 h-3.5 w-3.5" /> Remoto
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEdit(s)}
                        title="Editar balanza (IP, Nombre, Tienda)"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setSelectedIds([s.termId]);
                          setSendOpen(true);
                        }}
                        title="Enviar datos a esta balanza"
                      >
                        <Send className="h-3.5 w-3.5 text-primary" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{formState.termId ? 'Editar Balanza' : 'Nueva Balanza'}</DialogTitle>
            <DialogDescription>
              Configura los parámetros de red e identificación en term_admin.
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
                {(shopsQuery.data ?? []).map((s) => (
                  <option key={s.shopId} value={s.shopId}>
                    {s.shopName}
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
                <Label>N° de Serie (Sequence No)</Label>
                <Input
                  value={formState.sequenceNo}
                  onChange={(e) => setFormState({ ...formState, sequenceNo: e.target.value })}
                  placeholder="260514000005"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <input
                id="isMaster"
                type="checkbox"
                checked={formState.isMaster}
                onChange={(e) => setFormState({ ...formState, isMaster: e.target.checked })}
              />
              <Label htmlFor="isMaster">Balanza Principal (Master)</Label>
            </div>

            <div className="rounded-md border p-3 bg-muted/20 space-y-2 mt-2">
              <div className="flex items-center gap-2">
                <input
                  id="distributeImmediately"
                  type="checkbox"
                  checked={formState.distributeImmediately ?? true}
                  onChange={(e) =>
                    setFormState({ ...formState, distributeImmediately: e.target.checked })
                  }
                />
                <Label htmlFor="distributeImmediately" className="font-medium cursor-pointer text-sm">
                  Enviar datos a la balanza inmediatamente al guardar
                </Label>
              </div>
              <p className="text-xs text-muted-foreground pl-6">
                Sincroniza catálogo de productos, precios y etiquetas con la nueva configuración de IP y nombre.
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="secondary"
              disabled={saveMutation.isPending || !formState.termName || !formState.ipAddress}
              onClick={() => saveMutation.mutate({ ...formState, distributeImmediately: false })}
            >
              Solo Guardar
            </Button>
            <Button
              disabled={saveMutation.isPending || !formState.termName || !formState.ipAddress}
              onClick={() =>
                saveMutation.mutate({
                  ...formState,
                  distributeImmediately: true,
                  typeList: [0, 1, 2],
                })
              }
            >
              <Send className="mr-1.5 h-4 w-4" />
              {saveMutation.isPending ? 'Guardando y Enviando…' : 'Guardar y Enviar Datos'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar Datos a Balanzas</DialogTitle>
            <DialogDescription>
              Selecciona qué bloques de información sincronizar hacia {selectedIds.length}{' '}
              balanza(s).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={sendTypes.includes(0)}
                onChange={() => toggleSendType(0)}
              />
              Catálogo completo de productos (Tipo 0)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={sendTypes.includes(1)}
                onChange={() => toggleSendType(1)}
              />
              Actualización de precios (Tipo 1)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={sendTypes.includes(2)}
                onChange={() => toggleSendType(2)}
              />
              Imágenes y etiquetas (Tipo 2)
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={sendMutation.isPending || sendTypes.length === 0}
              onClick={() => sendMutation.mutate()}
            >
              {sendMutation.isPending ? 'Enviando…' : 'Enviar ahora'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={discoverOpen} onOpenChange={setDiscoverOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Balanzas detectadas en la red local</DialogTitle>
            <DialogDescription>
              Resultado del escaneo UDP/LAN desde term_admin.
            </DialogDescription>
          </DialogHeader>
          {discoveredList.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              No se detectaron equipos nuevos sin registrar en la subred.
            </p>
          ) : (
            <div className="max-h-64 overflow-auto space-y-2">
              {discoveredList.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between rounded border p-2 text-xs"
                >
                  <div>
                    <div className="font-mono font-medium">
                      {String(item.ipAddress ?? item.ip ?? 'IP desconocida')}
                    </div>
                    <div className="text-muted-foreground">
                      SN: {String(item.sequenceNo ?? item.boardSn ?? '—')}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => {
                      setDiscoverOpen(false);
                      setFormState({
                        termName: String(item.termName ?? 'Balanza ' + (idx + 1)),
                        shopId: shopsQuery.data?.[0]?.shopId ?? 3,
                        ipAddress: String(item.ipAddress ?? item.ip ?? ''),
                        sequenceNo: String(item.sequenceNo ?? item.boardSn ?? ''),
                        scaleNum: '1',
                        isMaster: false,
                      });
                      setFormOpen(true);
                    }}
                  >
                    Registrar
                  </Button>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setDiscoverOpen(false)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <VncViewerModal
        open={vncTarget !== null}
        onOpenChange={(o) => {
          if (!o) setVncTarget(null);
        }}
        termId={vncTarget?.id ?? 0}
        termName={vncTarget?.name ?? ''}
      />
    </div>
  );
}
