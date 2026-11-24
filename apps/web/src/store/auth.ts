import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@sdm/shared';

interface AuthState {
  user: User | null;
  token: string | null;
  expiresAt: string | null;
  setSession: (data: { user: User; token: string; expiresAt: string }) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      expiresAt: null,
      setSession: (data) => set({ user: data.user, token: data.token, expiresAt: data.expiresAt }),
      clear: () => set({ user: null, token: null, expiresAt: null }),
    }),
    { name: 'sdm-portal-auth' },
  ),
);
