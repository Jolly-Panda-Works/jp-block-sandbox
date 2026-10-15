import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  // Relative base: the build works at any path, e.g. https://<user>.github.io/<repo>/ (GitHub Pages).
  base: './',
  resolve: { alias: { '@jp/blocksy-shared': fileURLToPath(new URL('./shared/src/index.ts', import.meta.url)) } },
  server: { port: 5173, host: true },
});
