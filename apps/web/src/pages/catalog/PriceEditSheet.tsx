import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Product } from '@sdm/shared';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiClient } from '@/lib/queryClient';

interface Props {
  shopGoodId: number | null;
  onClose: () => void;
}

export function PriceEditSheet({ shopGoodId, onClose }: Props) {
  const qc = useQueryClient();
  const open = shopGoodId !== null;

  const q = useQuery({
    queryKey: ['product', shopGoodId],
    queryFn: async () => {
      if (shopGoodId === null) return null;
      const r = await apiClient.product(shopGoodId);
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    enabled: open,
  });

  const groupsQuery = useQuery({
    queryKey: ['productGroups', q.data?.shopId],
    queryFn: async () => {
      if (!q.data) return [];
      const response = await apiClient.productGroups(q.data.shopId);
      if (!response.ok) throw new Error(response.error.message);
      return response.data;
    },
    enabled: open && q.data !== undefined,
  });

  const [goodsPlu, setGoodsPlu] = useState<string>('');
  const [goodsName, setGoodsName] = useState<string>('');
  const [itemCode, setItemCode] = useState<string>('');
  const [priceModel, setPriceModel] = useState<string>('0');
  const [unitName, setUnitName] = useState<string>('');
  const [departmentGroupId, setDepartmentGroupId] = useState('__unchanged__');
  const [price, setPrice] = useState<string>('');
  const [memberPrice, setMemberPrice] = useState<string>('');
  const [promotionPrice, setPromotionPrice] = useState<string>('');

  useEffect(() => {
    if (q.data) {
      setGoodsPlu(q.data.goodsPlu ?? '');
      setGoodsName(q.data.goodsName ?? '');
      setItemCode(q.data.itemCode ?? '');
      setPriceModel(String(q.data.priceModel ?? 0));
      setUnitName(q.data.unitName ?? '');
      setDepartmentGroupId('__unchanged__');
      setPrice(q.data.price?.toString() ?? '');
      setMemberPrice(q.data.memberPrice?.toString() ?? '');
      setPromotionPrice(q.data.promotionPrice?.toString() ?? '');
    }
  }, [q.data]);

  const save = useMutation({
    mutationFn: async (p: Product) => {
      const body: {
        goodsPlu: string;
        goodsName: string;
        itemCode: string | null;
        priceModel: number;
        unitName: string | null;
        groupId?: number | null;
        price?: number;
        memberPrice: number | null;
        promotionPrice: number | null;
      } = {
        goodsPlu: goodsPlu.trim(),
        goodsName: goodsName.trim(),
        itemCode: itemCode.trim() === '' ? null : itemCode.trim(),
        priceModel: Number(priceModel),
        unitName: unitName.trim() === '' ? null : unitName.trim(),
        price: price === '' ? undefined : Number(price),
        memberPrice: memberPrice === '' ? null : Number(memberPrice),
        promotionPrice: promotionPrice === '' ? null : Number(promotionPrice),
      };
      if (departmentGroupId !== '__unchanged__') {
        body.groupId = departmentGroupId === '' ? null : Number(departmentGroupId);
      }
      const r = await apiClient.updateProduct(p.shopGoodId, body);
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    onSuccess: () => {
      toast.success('Producto actualizado');
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product', shopGoodId] });
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const del = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiClient.deleteProducts([id]);
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    onSuccess: () => {
      toast.success('Producto eliminado');
      qc.invalidateQueries({ queryKey: ['products'] });
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const p = q.data;
  const busy = save.isPending || del.isPending;
  const groups = groupsQuery.data ?? [];
  const normalizeGroupName = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
  const currentGroup = p?.deptCode
    ? groups.find((group) => normalizeGroupName(group.groupName) === normalizeGroupName(p.deptCode!))
    : undefined;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Editar producto</SheetTitle>
          <SheetDescription>
            {p ? `Tienda ${p.shopCode} · ID #${p.shopGoodId}` : 'Cargando…'}
          </SheetDescription>
        </SheetHeader>
        {p && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(p);
            }}
            className="space-y-4 mt-4"
          >
            {p.imagePath && (
              <div className="flex items-center gap-3 p-3 rounded-md border bg-muted/20">
                <img
                  src={p.imagePath.startsWith('/') ? p.imagePath : `/uploads/products/${p.imagePath}`}
                  alt={p.goodsName}
                  className="h-16 w-16 rounded object-cover border shadow-xs"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
                <div className="text-xs">
                  <div className="font-semibold text-foreground">Imagen asignada al PLU</div>
                  <div className="text-muted-foreground font-mono truncate max-w-[220px]">{p.imagePath}</div>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="goodsPlu">PLU</Label>
                <Input
                  id="goodsPlu"
                  value={goodsPlu}
                  onChange={(e) => setGoodsPlu(e.target.value)}
                  required
                  disabled={busy}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="itemCode">SKU / Código</Label>
                <Input
                  id="itemCode"
                  value={itemCode}
                  placeholder="(opcional)"
                  onChange={(e) => setItemCode(e.target.value)}
                  disabled={busy}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="goodsName">Nombre</Label>
              <Input
                id="goodsName"
                value={goodsName}
                onChange={(e) => setGoodsName(e.target.value)}
                required
                disabled={busy}
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="priceModel">Tipo</Label>
                <select
                  id="priceModel"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={priceModel}
                  onChange={(e) => setPriceModel(e.target.value)}
                  disabled={busy}
                >
                  <option value="0">Peso</option>
                  <option value="1">Conteo</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="unitName">Unidad</Label>
                <Input
                  id="unitName"
                  value={unitName}
                  placeholder="KG / UN"
                  onChange={(e) => setUnitName(e.target.value)}
                  disabled={busy}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="department-group">Departamento</Label>
              <select
                id="department-group"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={departmentGroupId}
                onChange={(event) => setDepartmentGroupId(event.target.value)}
                disabled={busy || groupsQuery.isLoading || groupsQuery.isError}
              >
                <option value="__unchanged__">Mantener sin cambios</option>
                <option value="">Sin departamento</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.groupName}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Departamento actual: {p.deptCode || 'sin departamento'}
                {p.deptCode && !currentGroup ? ' (no coincide con un grupo existente)' : ''}
              </p>
              {groupsQuery.isError && (
                <p className="text-xs text-destructive">
                  No se pudieron cargar los grupos: {(groupsQuery.error as Error).message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="price">Precio</Label>
              <Input
                id="price"
                type="number"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="memberPrice">Precio socio</Label>
              <Input
                id="memberPrice"
                type="number"
                step="0.01"
                value={memberPrice}
                placeholder="(sin precio socio)"
                onChange={(e) => setMemberPrice(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="promotionPrice">Precio promoción</Label>
              <Input
                id="promotionPrice"
                type="number"
                step="0.01"
                value={promotionPrice}
                placeholder="(sin promoción)"
                onChange={(e) => setPromotionPrice(e.target.value)}
                disabled={busy}
              />
            </div>

            <div className="flex items-center justify-between gap-2 pt-3 border-t">
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`¿Eliminar el producto "${p.goodsName}" (PLU ${p.goodsPlu})?`)) {
                    del.mutate(p.shopGoodId);
                  }
                }}
              >
                <Trash2 className="mr-1 h-4 w-4" />
                {del.isPending ? 'Eliminando…' : 'Eliminar'}
              </Button>

              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={busy}>
                  {save.isPending ? 'Guardando…' : 'Guardar'}
                </Button>
              </div>
            </div>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}