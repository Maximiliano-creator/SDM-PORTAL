import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';

export function RequireAdmin() {
  const user = useAuthStore((state) => state.user);
  return user?.role === 'admin' ? <Outlet /> : <Navigate to="/" replace />;
}
