export function startOfDay(d: Date): string {
  return d.toISOString().slice(0, 10) + ' 00:00:00';
}

export function endOfDay(d: Date): string {
  return d.toISOString().slice(0, 10) + ' 23:59:59';
}

export function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

export function toLocalDate(d: Date): string {
  // YYYY-MM-DD en zona local
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromInputDate(input: string, hour: 'start' | 'end'): string {
  return `${input} ${hour === 'start' ? '00:00:00' : '23:59:59'}`;
}

export function formatMoney(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return Math.round(v).toLocaleString('es-CL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}
