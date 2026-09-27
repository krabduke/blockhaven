import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 1200 },
  test: { environment: 'node' },
});
