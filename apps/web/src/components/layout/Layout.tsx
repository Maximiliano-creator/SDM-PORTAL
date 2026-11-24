import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Boxes,
  Gauge,
  LineChart,
  LogOut,
  Monitor,
  Package,
  Plug,
  Settings,
  Store,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/store/auth';
import { apiClient } from '@/lib/queryClient';
import { cn } from '@/lib/utils';
import { OfflineBanner } from './OfflineBanner';

const navItems = [
  { to: '/', label: 'Dashboard', icon: Gauge, end: true },
  { to: '/tiendas', label: 'Tiendas', icon: Store },
  { to: '/balanzas', label: 'Balanzas', icon: Monitor },
  { to: '/catalogo', label: 'Catálogo', icon: Package },
  { to: '/operarios', label: 'Operarios', icon: Users },
  { to: '/reportes', label: 'Reportes', icon: LineChart },
  { to: '/integracion-erp', label: 'Integración ERP', icon: Plug },
  { to: '/configuracion', label: 'Configuración', icon: Settings },
];

export function Layout() {
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);
  const navigate = useNavigate();

  async function handleLogout() {
    await apiClient.logout();
    clear();
    toast.success('Sesión cerrada');
    navigate('/login', { replace: true });
  }

  return (
    <div className="grid min-h-screen grid-cols-[260px_1fr] bg-muted/20">
      <aside className="flex flex-col border-r bg-card">
        <div className="flex h-16 items-center gap-2 border-b px-6">
          <Boxes className="h-6 w-6 text-primary" />
          <span className="text-lg font-semibold">SDM Portal</span>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t p-3">
          <div className="mb-2 px-2 text-xs">
            <div className="font-medium">{user?.fullName ?? user?.username}</div>
            <div className="text-muted-foreground">{user?.role}</div>
          </div>
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={handleLogout}>
            <LogOut className="mr-2 h-4 w-4" /> Cerrar sesión
          </Button>
        </div>
      </aside>
      <main className="flex flex-col">
        <header className="flex h-16 items-center justify-between border-b bg-card px-6">
          <h1 className="text-lg font-semibold">Panel de administración</h1>
          <div className="text-xs text-muted-foreground">v0.1.0</div>
        </header>
        <OfflineBanner />
        <div className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
