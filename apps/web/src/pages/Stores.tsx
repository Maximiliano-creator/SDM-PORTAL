import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  Edit3,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { apiClient } from '@/lib/queryClient';

type ExtendedShop = Record<string, unknown> & {
  shopId: number;
  shopCode: string;
  shopName: string;
  deptId?: number;
  deptName?: string;
  areaDetail?: string;
  marketId?: number | null;
  marketName?: string;
  directorId?: number;
  directorName?: string;
  directorPhone?: string;
  termNum?: number;
  openTime?: string;
  closeTime?: string;
  shopStatus?: boolean;
};

export function StoresPage() {
  const qc = useQueryClient();
  const [shopSearch, setShopSearch] = useState('');

  const shopsQuery = useQuery({
    queryKey: ['shops'],
    queryFn: async () => {
      const r = await apiClient.shops();
      if (!r.ok) throw new Error(r.error.message);
      return r.data as unknown as ExtendedShop[];
    },
  });

  const brandsQuery = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const r = await apiClient.brands();
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
  });

  const metaQuery = useQuery({
    queryKey: ['store-meta'],
    queryFn: async () => {
      const r = await apiClient.storeMeta();
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
  });

  const shops = shopsQuery.data ?? [];
  const brands = brandsQuery.data ?? [];
  const depts = metaQuery.data?.depts ?? [];
  const users = metaQuery.data?.users ?? [];

  const filteredShops = useMemo(() => {
    const q = shopSearch.trim().toLowerCase();
    if (!q) return shops;
    return shops.filter(
      (s) =>
        String(s.shopName ?? '').toLowerCase().includes(q) ||
        String(s.shopCode ?? '').toLowerCase().includes(q) ||
        String(s.deptName ?? '').toLowerCase().includes(q) ||
        String(s.marketName ?? '').toLowerCase().includes(q),
    );
  }, [shops, shopSearch]);

  const [shopDialogOpen, setShopDialogOpen] = useState(false);
  const [editingShop, setEditingShop] = useState<ExtendedShop | null>(null);
  const [shopForm, setShopForm] = useState({
    shopCode: '',
    shopName: '',
    deptId: 2,
    deptName: 'Región Metropolitana',
    areaDetail: '',
    marketId: '' as string | number,
    marketName: '',
    directorId: 1,
    directorName: 'administrators',
    directorPhone: '',
    openTime: '08:00:00',
    closeTime: '20:00:00',
    shopStatus: true,
  });

  function openNewShop() {
    const defaultBrand = brands[0];
    setEditingShop(null);
    setShopForm({
      shopCode: '',
      shopName: '',
      deptId: depts[0]?.id ?? 2,
      deptName: depts[0]?.name ?? 'Región Metropolitana',
      areaDetail: '',
      marketId: defaultBrand ? defaultBrand.id : '',
      marketName: defaultBrand ? defaultBrand.name : '',
      directorId: users[0]?.id ?? 1,
      directorName: users[0]?.name ?? 'administrators',
      directorPhone: users[0]?.phone ?? '',
      openTime: '08:00:00',
      closeTime: '20:00:00',
      shopStatus: true,
    });
    setShopDialogOpen(true);
  }

  function openEditShop(s: ExtendedShop) {
    setEditingShop(s);
    setShopForm({
      shopCode: String(s.shopCode ?? ''),
      shopName: String(s.shopName ?? ''),
      deptId: Number(s.deptId ?? 2),
      deptName: String(s.deptName ?? 'Región Metropolitana'),
      areaDetail: String(s.areaDetail ?? ''),
      marketId: s.marketId ?? '',
      marketName: String(s.marketName ?? ''),
      directorId: Number(s.directorId ?? 1),
      directorName: String(s.directorName ?? 'administrators'),
      directorPhone: String(s.directorPhone ?? ''),
      openTime: String(s.openTime ?? '08:00:00'),
      closeTime: String(s.closeTime ?? '20:00:00'),
      shopStatus: s.shopStatus !== false,
    });
    setShopDialogOpen(true);
  }

  const saveShopMutation = useMutation({
    mutationFn: async () => {
      if (!shopForm.shopCode.trim() || !shopForm.shopName.trim()) {
        throw new Error('Código y nombre de tienda son obligatorios');
      }
      const selectedBrand = brands.find((b) => String(b.id) === String(shopForm.marketId));
      const payload = {
        ...shopForm,
        marketId: selectedBrand ? selectedBrand.id : null,
        marketName: selectedBrand ? selectedBrand.name : '',
      };
      if (editingShop) {
        const r = await apiClient.updateShop(editingShop.shopId, payload);
        if (!r.ok) throw new Error(r.error.message);
      } else {
        const r = await apiClient.createShop(payload);
        if (!r.ok) throw new Error(r.error.message);
      }
    },
    onSuccess: () => {
      toast.success(editingShop ? 'Tienda actualizada correctamente' : 'Tienda creada correctamente');
      setShopDialogOpen(false);
      qc.invalidateQueries({ queryKey: ['shops'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteShopMutation = useMutation({
    mutationFn: async (shopId: number) => {
      const r = await apiClient.deleteShops([shopId]);
      if (!r.ok) throw new Error(r.error.message);
    },
    onSuccess: () => {
      toast.success('Tienda eliminada');
      qc.invalidateQueries({ queryKey: ['shops'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Tiendas</h2>
          <p className="text-sm text-muted-foreground">
            Administración de sucursales, regiones y encargados.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              shopsQuery.refetch();
              brandsQuery.refetch();
            }}
          >
            <RefreshCw className="mr-1.5 h-4 w-4" /> Actualizar
          </Button>
          <Button size="sm" onClick={openNewShop}>
            <Plus className="mr-1.5 h-4 w-4" /> Nueva tienda
          </Button>
        </div>
      </div>

      {
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Sucursales registradas</CardTitle>
              <CardDescription>
                Cada tienda agrupa sus balanzas y hereda la marca comercial configurada.
              </CardDescription>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nombre, código o región..."
                value={shopSearch}
                onChange={(e) => setShopSearch(e.target.value)}
                className="pl-8"
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">ID</TableHead>
                  <TableHead>Cód. Tienda</TableHead>
                  <TableHead>Nombre Tienda</TableHead>
                  <TableHead>Región</TableHead>
                  <TableHead>Marca</TableHead>
                  <TableHead>Encargado</TableHead>
                  <TableHead>Fono</TableHead>
                  <TableHead className="text-center">Balanzas</TableHead>
                  <TableHead className="text-right">Operación</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredShops.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                      No se encontraron tiendas registradas.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredShops.map((s) => (
                    <TableRow key={s.shopId}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {s.shopId}
                      </TableCell>
                      <TableCell className="font-mono text-xs font-medium">{s.shopCode}</TableCell>
                      <TableCell className="font-medium">
                        <div>{s.shopName}</div>
                        {s.areaDetail && (
                          <div className="text-xs text-muted-foreground">{s.areaDetail}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{s.deptName || '—'}</TableCell>
                      <TableCell>
                        {s.marketName ? (
                          <Badge variant="outline" className="gap-1">
                            <Building2 className="h-3 w-3" />
                            {s.marketName}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Sin marca</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{s.directorName || '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{s.directorPhone || '—'}</TableCell>
                      <TableCell className="text-center font-semibold">{s.termNum ?? 0}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button variant="outline" size="sm" onClick={() => openEditShop(s)}>
                            <Edit3 className="mr-1 h-3.5 w-3.5" /> Editar
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={deleteShopMutation.isPending}
                            onClick={() => {
                              if (confirm(`¿Eliminar la tienda "${s.shopName}"?`)) {
                                deleteShopMutation.mutate(s.shopId);
                              }
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      }

      <Dialog open={shopDialogOpen} onOpenChange={setShopDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingShop ? 'Editar tienda' : 'Nueva tienda'}</DialogTitle>
            <DialogDescription>
              Completa los datos operativos de la sucursal y vincula su marca correspondiente.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Código de tienda *</Label>
              <Input
                value={shopForm.shopCode}
                onChange={(e) => setShopForm({ ...shopForm, shopCode: e.target.value })}
                placeholder="Ej. 2026"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Nombre de tienda *</Label>
              <Input
                value={shopForm.shopName}
                onChange={(e) => setShopForm({ ...shopForm, shopName: e.target.value })}
                placeholder="Ej. Tienda ITA"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Marca asociada</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                value={shopForm.marketId}
                onChange={(e) => {
                  const id = e.target.value;
                  const found = brands.find((b) => String(b.id) === id);
                  setShopForm({
                    ...shopForm,
                    marketId: id ? Number(id) : '',
                    marketName: found?.name ?? '',
                  });
                }}
              >
                <option value="">-- Sin marca --</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} {b.status ? '' : '(Desactivada)'}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Región / Zona</Label>
              {depts.length > 0 ? (
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                  value={shopForm.deptId}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    const found = depts.find((d) => d.id === id);
                    setShopForm({
                      ...shopForm,
                      deptId: id,
                      deptName: found?.name ?? shopForm.deptName,
                    });
                  }}
                >
                  {depts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  value={shopForm.deptName}
                  onChange={(e) => setShopForm({ ...shopForm, deptName: e.target.value })}
                />
              )}
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Dirección</Label>
              <Input
                value={shopForm.areaDetail}
                onChange={(e) => setShopForm({ ...shopForm, areaDetail: e.target.value })}
                placeholder="Ej. Francisco Meneses 1980"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Encargado</Label>
              {users.length > 0 ? (
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                  value={shopForm.directorId}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    const found = users.find((u) => u.id === id);
                    setShopForm({
                      ...shopForm,
                      directorId: id,
                      directorName: found?.name ?? shopForm.directorName,
                      directorPhone: found?.phone || shopForm.directorPhone,
                    });
                  }}
                >
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  value={shopForm.directorName}
                  onChange={(e) => setShopForm({ ...shopForm, directorName: e.target.value })}
                />
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Teléfono de contacto</Label>
              <Input
                value={shopForm.directorPhone}
                onChange={(e) => setShopForm({ ...shopForm, directorPhone: e.target.value })}
                placeholder="Ej. +56 9 1234 5678"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShopDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={saveShopMutation.isPending}
              onClick={() => saveShopMutation.mutate()}
            >
              {saveShopMutation.isPending ? 'Guardando...' : 'Guardar tienda'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      </div>
  );
}
