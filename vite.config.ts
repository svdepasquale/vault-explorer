import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The SPA lives in src/web; the Node server (src/server) serves the built
// bundle from dist/web, or mounts Vite as middleware in --dev mode.
export default defineConfig({
  root: fileURLToPath(new URL('./src/web', import.meta.url)),
  base: './',
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('./dist/web', import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
});
