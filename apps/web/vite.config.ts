import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const listenHost =
  process.env.SDM_PORTAL_LISTEN_HOST === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    target: 'es2022',
  },
  optimizeDeps: {
    esbuildOptions: { target: 'es2022' },
  },
  server: {
    port: 5173,
    strictPort: true,
    host: listenHost,
    allowedHosts: ['sdm-portal.kohr.cl'],
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8788',
        changeOrigin: false,
        ws: true,
      },
    },
  },
  preview: {
    port: 5173,
    strictPort: true,
    host: listenHost,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8788',
        changeOrigin: false,
        ws: true,
      },
    },
  },
});
