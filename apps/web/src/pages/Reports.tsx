import { Link, Outlet, useLocation } from 'react-router-dom';
import { ClipboardList, LineChart, Receipt } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';

const tabs = [
  { to: '/reportes/ventas', label: 'Ventas', icon: Receipt },
  { to: '/reportes/balanzas', label: 'Balanzas', icon: LineChart },
  { to: '/reportes/auditoria', label: 'Auditoría', icon: ClipboardList },
];

export function ReportsLayout() {
  const location = useLocation();
  const isAdmin = useAuthStore((state) => state.user?.role === 'admin');
  const isIndex = location.pathname === '/reportes' || location.pathname === '/reportes/';
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Reportes</h2>
        <p className="text-sm text-muted-foreground">
          Datos de venta, performance de balanzas y auditoría.
        </p>
      </div>
      <div className="flex gap-2 border-b">
        {tabs.filter((tab) => tab.to !== '/reportes/auditoria' || isAdmin).map((t) => {
          const active =
            location.pathname === t.to ||
            (isIndex && t.to === '/reportes/ventas');
          return (
            <Link
              key={t.to}
              to={t.to}
              className={cn(
                'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px',
                active
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <t.icon className="h-4 w-4" /> {t.label}
            </Link>
          );
        })}
      </div>
      <Outlet />
    </div>
  );
}
