import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Download, Layers, Pencil, Search, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import type { Shop } from '@sdm/shared';
import { Badge } from '@/components/ui/badge';
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
import { useDebounce } from '@/hooks/useDebounce';
import { PriceEditSheet } from './catalog/PriceEditSheet';
import { BulkPriceDialog } from './catalog/BulkPriceDialog';
import {
  BulkDepartmentDialog,
  ProductGroupManagementDialog,
} from './catalog/ProductGroupDialogs';

function formatPrice(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function CatalogPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [shopFilter, setShopFilter] = useState<string>('');
  const [priceModelFilter, setPriceModelFilter] = useState<string>('');
  const [page, setPage] = useState(0);
  const size = 25;
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkDepartmentOpen, setBulkDepartmentOpen] = useState(false);
  const [groupManagementOpen, setGroupManagementOpen] = useState(false);

  const debouncedSearch = useDebounce(search, 300);

  const shopsQuery = useQuery({
    queryKey: ['shops'],
    queryFn: async () => {
      const r = await apiClient.shops();
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
  });

  const filters = useMemo(
    () => ({
      page,
      size,
      goodsName: debouncedSearch || undefined,
      shopId: shopFilter ? Number(shopFilter) : undefined,
      priceModel: priceModelFilter !== '' ? Number(priceModelFilter) : undefined,
    }),
    [page, debouncedSearch, shopFilter, priceModelFilter],
  );

  const productsQuery = useQuery({
    queryKey: ['products', filters],
    queryFn: async () => {
      const r = await apiClient.products(filters);
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    placeholderData: (prev) => prev,
  });

  const shopMap = useMemo(() => {
    const m = new Map<number, Shop>();
    for (const s of shopsQuery.data ?? []) m.set(s.shopId, s);
    return m;
  }, [shopsQuery.data]);

  const rows = productsQuery.data?.content ?? [];
  const total = productsQuery.data?.totalElements ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / size));

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => {
      const allOnPage = rows.map((r) => r.shopGoodId);
      const allSelected = allOnPage.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSelected) allOnPage.forEach((id) => next.delete(id));
      else allOnPage.forEach((id) => next.add(id));
      return next;
    });
  }

  const bulkDeleteMut = useMutation({
    mutationFn: async (ids: number[]) => {
      const r = await apiClient.deleteProducts(ids);
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    onSuccess: (d) => {
      toast.success(`${d.deleted} producto(s) eliminado(s)`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function resetFilters() {
    setSearch('');
    setShopFilter('');
    setPriceModelFilter('');
    setPage(0);
  }

  if (productsQuery.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Error al cargar catálogo</CardTitle>
          <CardDescription>{(productsQuery.error as Error).message}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button onClick={() => productsQuery.refetch()}>Reintentar</Button>
        </CardContent>
      </Card>
    );
  }

  const selectedOnPage = rows.filter((r) => selected.has(r.shopGoodId)).length;
  const allOnPageSelected = rows.length > 0 && selectedOnPage === rows.length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Catálogo</h2>
          <p className="text-sm text-muted-foreground">
            {productsQuery.isLoading
              ? 'Cargando…'
              : `${total} producto${total === 1 ? '' : 's'} · página ${page + 1} de ${totalPages}`}
          </p>
        </div>
        <div className="flex gap-2">
          {selected.size > 0 && (
            <>
              <Badge variant="secondary" className="text-sm">
                {selected.size} seleccionado(s)
              </Badge>
              <Button onClick={() => setBulkOpen(true)}>Editar masivo</Button>
              <Button variant="outline" onClick={() => setBulkDepartmentOpen(true)}>
                Cambiar departamento
              </Button>
              <Button
                variant="destructive"
                disabled={bulkDeleteMut.isPending}
                onClick={() => {
                  if (window.confirm(`¿Eliminar ${selected.size} producto(s) seleccionado(s)?`)) {
                    bulkDeleteMut.mutate(Array.from(selected));
                  }
                }}
              >
                <Trash2 className="mr-1 h-4 w-4" />
                {bulkDeleteMut.isPending ? 'Eliminando…' : 'Eliminar'}
              </Button>
              <Button variant="ghost" onClick={() => setSelected(new Set())}>
                Limpiar
              </Button>
            </>
          )}
          <Button
            variant="outline"
            onClick={async () => {
              try {
                const allRes = await apiClient.products({ ...filters, size: 1000, page: 0 });
                if (!allRes.ok) throw new Error(allRes.error.message);
                const { exportProductsToExcel } = await import('@/lib/excel');
                await exportProductsToExcel(allRes.data.content);
                toast.success(`Exportados ${allRes.data.content.length} producto(s)`);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'No se pudo exportar');
              }
            }}
          >
            <Download className="h-4 w-4" /> Exportar
          </Button>
          <Button asChild>
            <Link to="/catalogo/importar">
              <Upload className="h-4 w-4" /> Importar Excel
            </Link>
          </Button>
          <Button variant="outline" onClick={() => setGroupManagementOpen(true)}>
            <Layers className="h-4 w-4" /> Agrupaciones
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            className="pl-9 w-80"
          />
        </div>
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={shopFilter}
          onChange={(e) => {
            setShopFilter(e.target.value);
            setPage(0);
          }}
        >
          <option value="">Todas las tiendas</option>
          {(shopsQuery.data ?? []).map((s) => (
            <option key={s.shopId} value={s.shopId}>
              {s.shopName}
            </option>
          ))}
        </select>
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={priceModelFilter}
          onChange={(e) => {
            setPriceModelFilter(e.target.value);
            setPage(0);
          }}
        >
          <option value="">Pesables y de conteo</option>
          <option value="0">Pesables</option>
          <option value="1">De conteo</option>
        </select>
        {(search || shopFilter || priceModelFilter) && (
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            Limpiar filtros
          </Button>
        )}
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  onChange={toggleAll}
                  className="h-4 w-4"
                />
              </TableHead>
              <TableHead className="w-12">Foto</TableHead>
              <TableHead>PLU</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>Tienda</TableHead>
              <TableHead>Departamento</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right">Precio</TableHead>
              <TableHead className="text-right">Socio</TableHead>
              <TableHead className="text-right">Promo</TableHead>
              <TableHead className="w-24 text-right"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && !productsQuery.isLoading && (
              <TableRow>
                <TableCell colSpan={11} className="py-8 text-center text-sm text-muted-foreground">
                  Sin resultados con los filtros actuales.
                </TableCell>
              </TableRow>
            )}
            {rows.map((p) => (
              <TableRow
                key={p.shopGoodId}
                data-state={selected.has(p.shopGoodId) ? 'selected' : undefined}
              >
                <TableCell>
                  <input
                    type="checkbox"
                    checked={selected.has(p.shopGoodId)}
                    onChange={() => toggle(p.shopGoodId)}
                    className="h-4 w-4"
                  />
                </TableCell>
                <TableCell>
                  {p.imagePath ? (
                    <img
                      src={p.imagePath.startsWith('/') ? p.imagePath : `/uploads/products/${p.imagePath}`}
                      alt={p.goodsName}
                      className="h-9 w-9 rounded object-cover border shadow-xs"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="h-9 w-9 rounded bg-muted/60 border border-dashed flex items-center justify-center text-[10px] text-muted-foreground font-semibold">
                      {p.goodsName ? p.goodsName.slice(0, 2).toUpperCase() : 'PL'}
                    </div>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">{p.goodsPlu}</TableCell>
                <TableCell>
                  <div className="font-medium">{p.goodsName}</div>
                  {p.itemCode && (
                    <div className="text-xs text-muted-foreground">SKU {p.itemCode}</div>
                  )}
                </TableCell>
                <TableCell className="text-xs">{shopMap.get(p.shopId)?.shopName ?? p.shopCode}</TableCell>
                <TableCell className="text-xs">{p.deptCode || '—'}</TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {p.priceModel === 0 ? `Peso ${p.unitName ?? ''}` : 'Conteo'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-mono">{formatPrice(p.price)}</TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">
                  {formatPrice(p.memberPrice)}
                </TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">
                  {formatPrice(p.promotionPrice)}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Editar producto"
                      onClick={() => setEditingId(p.shopGoodId)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Eliminar producto"
                      disabled={bulkDeleteMut.isPending}
                      onClick={() => {
                        if (window.confirm(`¿Eliminar "${p.goodsName}" (PLU ${p.goodsPlu})?`)) {
                          bulkDeleteMut.mutate([p.shopGoodId]);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between border-t p-3 text-sm">
          <div className="text-muted-foreground">
            {selected.size > 0 ? `${selected.size} seleccionado(s) en total` : ''}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0 || productsQuery.isFetching}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Anterior
            </Button>
            <span className="text-xs text-muted-foreground">
              Página {page + 1} de {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1 || productsQuery.isFetching}
              onClick={() => setPage((p) => p + 1)}
            >
              Siguiente
            </Button>
          </div>
        </div>
      </Card>

      <PriceEditSheet shopGoodId={editingId} onClose={() => setEditingId(null)} />
      <BulkPriceDialog
        open={bulkOpen}
        shopGoodIds={Array.from(selected)}
        onClose={() => setBulkOpen(false)}
      />
      <BulkDepartmentDialog
        open={bulkDepartmentOpen}
        shopGoodIds={Array.from(selected)}
        shops={shopsQuery.data ?? []}
        initialShopId={shopFilter ? Number(shopFilter) : undefined}
        onClose={() => setBulkDepartmentOpen(false)}
      />
      <ProductGroupManagementDialog
        open={groupManagementOpen}
        shops={shopsQuery.data ?? []}
        initialShopId={shopFilter ? Number(shopFilter) : undefined}
        onClose={() => setGroupManagementOpen(false)}
      />
    </div>
  );
}