import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
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

interface Props {
  open: boolean;
  shopGoodIds: number[];
  onClose: () => void;
}

export function BulkPriceDialog({ open, shopGoodIds, onClose }: Props) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'percent' | 'fixed' | 'set'>('percent');
  const [value, setValue] = useState<string>('5');
  const [field, setField] = useState<'price' | 'memberPrice' | 'promotionPrice'>('price');

  const apply = useMutation({
    mutationFn: async () => {
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) throw new Error('Valor inválido');
      const r = await apiClient.bulkUpdatePrice({
        shopGoodIds,
        mode,
        value: numericValue,
        field,
      });
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    onSuccess: (data) => {
      const msg = `Aplicado a ${data.success}/${data.requested} productos${data.failed > 0 ? ` (${data.failed} fallaron)` : ''}`;
      if (data.failed > 0) toast.warning(msg);
      else toast.success(msg);
      qc.invalidateQueries({ queryKey: ['products'] });
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const explain = (() => {
    const v = Number(value);
    if (!Number.isFinite(v)) return 'Valor inválido';
    switch (mode) {
      case 'percent':
        return v >= 0
          ? `Aumentar el ${field === 'price' ? 'precio' : field} en ${v}%`
          : `Reducir el ${field === 'price' ? 'precio' : field} en ${Math.abs(v)}%`;
      case 'fixed':
        return v >= 0
          ? `Sumar ${v} al ${field === 'price' ? 'precio' : field}`
          : `Restar ${Math.abs(v)} al ${field === 'price' ? 'precio' : field}`;
      case 'set':
        return `Setear el ${field === 'price' ? 'precio' : field} a ${v}`;
    }
  })();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edición masiva de precios</DialogTitle>
          <DialogDescription>
            Se aplicará a <strong>{shopGoodIds.length}</strong> producto(s) seleccionado(s).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Campo a modificar</Label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={field}
              onChange={(e) => setField(e.target.value as typeof field)}
            >
              <option value="price">Precio normal</option>
              <option value="memberPrice">Precio socio</option>
              <option value="promotionPrice">Precio promoción</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label>Modo</Label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
            >
              <option value="percent">Cambio porcentual (%)</option>
              <option value="fixed">Sumar/restar monto fijo</option>
              <option value="set">Setear a un valor fijo</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="value">Valor</Label>
            <Input
              id="value"
              type="number"
              step="0.01"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={mode === 'percent' ? 'ej: 5 para +5%, -10 para -10%' : 'monto'}
            />
            <p className="text-xs text-muted-foreground">{explain}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={apply.isPending}>
            Cancelar
          </Button>
          <Button onClick={() => apply.mutate()} disabled={apply.isPending}>
            {apply.isPending ? 'Aplicando…' : `Aplicar a ${shopGoodIds.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
