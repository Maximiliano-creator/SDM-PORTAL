import { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiClient, setUnauthorizedHandler } from './api';
import { useAuthStore } from '@/store/auth';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => {
        if (err instanceof Error && err.message.includes('401')) return false;
        return count < 1;
      },
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

export const apiClient = new ApiClient();

let redirected = false;
setUnauthorizedHandler(() => {
  if (redirected) return;
  redirected = true;
  useAuthStore.getState().clear();
  queryClient.clear();
  toast.error('Tu sesión expiró. Volvé a ingresar.');
  // Redirigir solo si no estamos ya en /login
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.assign('/login');
  }
  setTimeout(() => {
    redirected = false;
  }, 2000);
});
