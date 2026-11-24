import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { queryClient } from '@/lib/queryClient';
import { LoginPage } from '@/pages/Login';
import { DashboardPage } from '@/pages/Dashboard';
import { ScalesPage } from '@/pages/Scales';
import { StoresPage } from '@/pages/Stores';
import { ScaleDetailPage } from '@/pages/ScaleDetail';
import { ScaleRemotePage } from '@/pages/ScaleRemote';
import { SettingsPage } from '@/pages/Settings';
import { lazy, Suspense } from 'react';
import { CatalogPage } from '@/pages/Catalog';
import { ReportsLayout } from '@/pages/Reports';
const SalesReport = lazy(() =>
  import('@/pages/reports/Sales').then((m) => ({ default: m.SalesReport })),
);
const ScaleStatsReport = lazy(() =>
  import('@/pages/reports/ScaleStats').then((m) => ({ default: m.ScaleStatsReport })),
);
const AuditReport = lazy(() =>
  import('@/pages/reports/Audit').then((m) => ({ default: m.AuditReport })),
);
const CatalogImportPage = lazy(() =>
  import('@/pages/CatalogImport').then((m) => ({ default: m.CatalogImportPage })),
);
const ErpPage = lazy(() => import('@/pages/Erp').then((m) => ({ default: m.ErpPage })));

function lazyWrap(node: React.ReactNode) {
  return (
    <Suspense fallback={<div className="text-sm text-muted-foreground">Cargando…</div>}>
      {node}
    </Suspense>
  );
}
import { Placeholder } from '@/pages/Placeholder';
import { Layout } from '@/components/layout/Layout';
import { RequireAuth } from '@/components/RequireAuth';

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route path="balanzas/:id/remoto" element={<ScaleRemotePage />} />
            <Route element={<Layout />}>
              <Route index element={<DashboardPage />} />
              <Route path="balanzas" element={<ScalesPage />} />
              <Route path="tiendas" element={<StoresPage />} />
              <Route path="balanzas/:id" element={<ScaleDetailPage />} />
              <Route path="catalogo" element={<CatalogPage />} />
              <Route path="catalogo/importar" element={lazyWrap(<CatalogImportPage />)} />
              <Route path="operarios" element={<Placeholder title="Operarios" phase="Fase 2" />} />
              <Route path="reportes" element={<ReportsLayout />}>
                <Route index element={lazyWrap(<SalesReport />)} />
                <Route path="ventas" element={lazyWrap(<SalesReport />)} />
                <Route path="balanzas" element={lazyWrap(<ScaleStatsReport />)} />
                <Route path="auditoria" element={lazyWrap(<AuditReport />)} />
              </Route>
              <Route path="integracion-erp" element={lazyWrap(<ErpPage />)} />
              <Route path="configuracion" element={<SettingsPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}

