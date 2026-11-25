import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Shop } from '@sdm/shared';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiClient } from '@/lib/queryClient';
import { useAuthStore } from '@/store/auth';

interface ShopProps {
  shops: Shop[];
  initialShopId?: number;
}

interface GroupManagementProps extends ShopProps {
  open: boolean;
  onClose: () => void;
}

export function ProductGroupManagementDialog({
  open,
  onClose,
  shops,
  initialShopId,
}: GroupManagementProps) {
  const qc = useQueryClient();
  const isAdmin = useAuthStore((state) => state.user?.role === 'admin');
  const [shopId, setShopId] = useState<number | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');

  useEffect(() => {
    if (open) setShopId(initialShopId ?? null);
  }, [open, initialShopId]);

  useEffect(() => {
    if (open && shopId === null && shops.length > 0) setShopId(shops[0]!.shopId);
  }, [open, shopId, shops]);

  const groupsQuery = useQuery({
    queryKey: ['productGroups', shopId],
    queryFn: async () => {
      if (shopId === null) return [];
      const response = await apiClient.productGroups(shopId);
      if (!response.ok) throw new Error(response.error.message);
      return response.data;
    },
    enabled: open && shopId !== null,
  });

  function invalidateCatalog() {
    qc.invalidateQueries({ queryKey: ['productGroups'] });
    qc.invalidateQueries({ queryKey: ['products'] });
    qc.invalidateQueries({ queryKey: ['product'] });
  }

  const create = useMutation({
    mutationFn: async () => {
      if (shopId === null) throw new Error('Selecciona una tienda');
      const response = await apiClient.createProductGroup({
        shopId,
        groupName: newGroupName.trim(),
      });
      if (!response.ok) throw new Error(response.error.message);
      return response.data;
    },
    onSuccess: (group) => {
      toast.success(`Grupo "${group.groupName}" creado`);
      setNewGroupName('');
      invalidateCatalog();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, groupName }: { id: number; groupName: string }) => {
      if (shopId === null) throw new Error('Selecciona una tienda');
      const response = await apiClient.updateProductGroup(id, { shopId, groupName });
      if (!response.ok) throw new Error(response.error.message);
      return response.data;
    },
    onSuccess: (data) => {
      if (data.failedProducts > 0) {
        const detail = data.errors[0];
        toast.warning(
          `Grupo renombrado; ${data.updatedProducts ?? 0} PLU(s) sincronizados y ${data.failedProducts} con error${detail ? `: ${detail.goodsPlu} — ${detail.error}` : ''}`,
        );
      } else {
        toast.success(`Grupo actualizado y ${data.updatedProducts ?? 0} PLU(s) sincronizados`);
      }
      setEditingId(null);
      invalidateCatalog();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      if (shopId === null) throw new Error('Selecciona una tienda');
      const response = await apiClient.deleteProductGroup(id, shopId);
      if (!response.ok) throw new Error(response.error.message);
      return response.data;
    },
    onSuccess: (data) => {
      if (!data.deleted) {
        const detail = data.errors[0];
        toast.warning(
          `Grupo no eliminado; ${data.unassignedProducts} PLU(s) ya quedaron sin departamento${detail ? `: ${detail.goodsPlu ? `${detail.goodsPlu} — ` : ''}${detail.error}` : ''}`,
        );
        invalidateCatalog();
        return;
      }
      toast.success(`Grupo eliminado; ${data.unassignedProducts} PLU(s) desvinculados`);
      invalidateCatalog();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const busy = create.isPending || update.isPending || remove.isPending;
  const selectedShop = shops.find((shop) => shop.shopId === shopId);

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Administrar departamentos</DialogTitle>
          <DialogDescription>
            Los departamentos son grupos por tienda. Al renombrar o eliminar, también se sincroniza
            el campo de departamento de los PLU asociados.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="group-shop">Tienda</Label>
            <select
              id="group-shop"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={shopId ?? ''}
              onChange={(event) => {
                setShopId(event.target.value ? Number(event.target.value) : null);
                setEditingId(null);
              }}
              disabled={busy}
            >
              <option value="">Selecciona una tienda</option>
              {shops.map((shop) => (
                <option key={shop.shopId} value={shop.shopId}>
                  {shop.shopName}
                </option>
              ))}
            </select>
          </div>

          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <div className="flex-1 space-y-2">
              <Label htmlFor="new-group-name">Nuevo departamento (máximo 30 caracteres)</Label>
              <Input
                id="new-group-name"
                value={newGroupName}
                onChange={(event) => setNewGroupName(event.target.value)}
                maxLength={30}
                required
                disabled={busy || shopId === null}
                placeholder="Ej.: Lácteos"
              />
            </div>
            <Button type="submit" disabled={busy || shopId === null || !newGroupName.trim()}>
              <Plus className="h-4 w-4" />
              Crear
            </Button>
          </form>

          {groupsQuery.isError && (
            <p className="text-sm text-destructive">
              Error al cargar los grupos: {(groupsQuery.error as Error).message}
            </p>
          )}
          {groupsQuery.isLoading && (
            <p className="text-sm text-muted-foreground">Cargando departamentos…</p>
          )}
          {!groupsQuery.isLoading && !groupsQuery.isError && shopId !== null && (
            <div className="divide-y rounded-md border">
              {(groupsQuery.data ?? []).length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">
                  {selectedShop
                    ? `No hay departamentos en ${selectedShop.shopName}.`
                    : 'No hay departamentos.'}
                </p>
              )}
              {(groupsQuery.data ?? []).map((group) => (
                <div key={group.id} className="flex items-center gap-3 p-3">
                  {editingId === group.id ? (
                    <>
                      <Input
                        aria-label={`Nuevo nombre para ${group.groupName}`}
                        value={editingName}
                        onChange={(event) => setEditingName(event.target.value)}
                        maxLength={30}
                        disabled={busy}
                      />
                      <Button
                        size="icon"
                        aria-label="Guardar nombre"
                        disabled={busy || !editingName.trim()}
                        onClick={() =>
                          update.mutate({ id: group.id, groupName: editingName.trim() })
                        }
                      >
                        <Save className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="outline"
                        aria-label="Cancelar edición"
                        disabled={busy}
                        onClick={() => setEditingId(null)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{group.groupName}</div>
                        <div className="text-xs text-muted-foreground">Grupo #{group.groupNum}</div>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Renombrar grupo"
                        disabled={busy}
                        onClick={() => {
                          setEditingId(group.id);
                          setEditingName(group.groupName);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {isAdmin && <Button
                        size="icon"
                        variant="ghost"
                        title="Eliminar grupo"
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              `¿Eliminar "${group.groupName}"? Los productos se conservarán, se limpiará su departamento y se quitará la agrupación de las balanzas.`,
                            )
                          ) {
                            remove.mutate(group.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface BulkDepartmentProps extends ShopProps {
  open: boolean;
  shopGoodIds: number[];
  onClose: () => void;
}

export function BulkDepartmentDialog({
  open,
  onClose,
  shops,
  initialShopId,
  shopGoodIds,
}: BulkDepartmentProps) {
  const qc = useQueryClient();
  const [shopId, setShopId] = useState<number | null>(null);
  const [groupId, setGroupId] = useState('__unset__');

  useEffect(() => {
    if (open) {
      setShopId(initialShopId ?? null);
      setGroupId('__unset__');
    }
  }, [open, initialShopId]);

  const groupsQuery = useQuery({
    queryKey: ['productGroups', shopId],
    queryFn: async () => {
      if (shopId === null) return [];
      const response = await apiClient.productGroups(shopId);
      if (!response.ok) throw new Error(response.error.message);
      return response.data;
    },
    enabled: open && shopId !== null,
  });

  const apply = useMutation({
    mutationFn: async () => {
      if (groupId === '__unset__')
        throw new Error('Selecciona un departamento o "Sin departamento"');
      const response = await apiClient.bulkUpdateDepartment({
        shopGoodIds,
        groupId: groupId === '' ? null : Number(groupId),
        shopId: groupId === '' ? undefined : (shopId ?? undefined),
      });
      if (!response.ok) throw new Error(response.error.message);
      return response.data;
    },
    onSuccess: (data) => {
      const firstError = data.errors[0];
      const message = `Departamento actualizado en ${data.updated}/${data.requested} PLU(s)${data.failed > 0 ? `; ${data.failed} con error${firstError ? `: ${firstError.goodsPlu || `ID ${firstError.shopGoodId}`} — ${firstError.error}` : ''}` : ''}`;
      if (data.failed > 0) toast.warning(message);
      else toast.success(message);
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product'] });
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cambiar departamento en lote</DialogTitle>
          <DialogDescription>
            Se aplicará a <strong>{shopGoodIds.length}</strong> PLU(s). Los productos de otras
            tiendas se reportarán como error.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="bulk-department-shop">Tienda del departamento</Label>
            <select
              id="bulk-department-shop"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={shopId ?? ''}
              onChange={(event) => {
                setShopId(event.target.value ? Number(event.target.value) : null);
                if (groupId !== '') setGroupId('__unset__');
              }}
              disabled={apply.isPending}
            >
              <option value="">Selecciona una tienda</option>
              {shops.map((shop) => (
                <option key={shop.shopId} value={shop.shopId}>
                  {shop.shopName}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="bulk-department-group">Departamento destino</Label>
            <select
              id="bulk-department-group"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={groupId}
              onChange={(event) => setGroupId(event.target.value)}
              disabled={apply.isPending}
            >
              <option value="__unset__">Selecciona…</option>
              <option value="">Sin departamento</option>
              {(groupsQuery.data ?? []).map((group) => (
                <option key={group.id} value={group.id}>
                  {group.groupName}
                </option>
              ))}
            </select>
            {groupsQuery.isError && (
              <p className="text-xs text-destructive">
                Error al cargar departamentos: {(groupsQuery.error as Error).message}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={apply.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={() => apply.mutate()}
            disabled={apply.isPending || groupId === '__unset__' || shopGoodIds.length === 0}
          >
            {apply.isPending ? 'Aplicando…' : 'Aplicar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
