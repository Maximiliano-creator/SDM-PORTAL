import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';

export function RequireAuth() {
  const token = useAuthStore((s) => s.token);
  const expiresAt = useAuthStore((s) => s.expiresAt);
  const location = useLocation();

  const valid = token && (!expiresAt || new Date(expiresAt) > new Date());
  if (!valid) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <Outlet />;
}
