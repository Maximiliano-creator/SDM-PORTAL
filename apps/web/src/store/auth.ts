import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@sdm/shared';

if (typeof window !== 'undefined') {
  window.localStorage.removeItem('sdm-portal-auth');
}

interface AuthState {
  user: User | null;
  expiresAt: string | null;
  setSession: (data: { user: User; expiresAt: string }) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      expiresAt: null,
      setSession: (data) => set({ user: data.user, expiresAt: data.expiresAt }),
      clear: () => set({ user: null, expiresAt: null }),
    }),
    {
      name: 'sdm-portal-auth',
      partialize: ({ user, expiresAt }) => ({ user, expiresAt }),
    },
  ),
);
