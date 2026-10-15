import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true },
  // The shared workspace package is TypeScript source; let Vite transform it instead of pre-bundling.
  optimizeDeps: { exclude: ['@jp/block-sandbox-shared'] },
});
