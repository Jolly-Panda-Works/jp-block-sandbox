import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  // shared/ is plain TypeScript source vendored into this repo (also present in blocksy-server).
  resolve: { alias: { '@jp/blocksy-shared': fileURLToPath(new URL('./shared/src/index.ts', import.meta.url)) } },
  server: { port: 5173, host: true },
});
