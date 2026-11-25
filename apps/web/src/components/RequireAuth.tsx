import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';

export function RequireAuth() {
  const user = useAuthStore((s) => s.user);
  const expiresAt = useAuthStore((s) => s.expiresAt);
  const location = useLocation();

  const valid = user && expiresAt && new Date(expiresAt) > new Date();
  if (!valid) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <Outlet />;
}
