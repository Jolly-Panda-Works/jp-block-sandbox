import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const sharedEntry = fileURLToPath(new URL('../shared/src/index.ts', import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Resolve the shared package straight from source. This doesn't depend on the npm workspace link
  // (a Windows junction with an absolute path, which breaks when the project folder is moved or copied).
  resolve: { alias: { '@jp/block-sandbox-shared': sharedEntry } },
  server: { port: 5173, host: true, fs: { allow: ['..'] } },
  optimizeDeps: { exclude: ['@jp/block-sandbox-shared'] },
});
