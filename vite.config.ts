import { defineConfig, type Plugin } from 'vite';

// Every build gets an id; the page compares it with version.json to notice updates.
const BUILD_ID = Date.now().toString(36);
const versionFile = (): Plugin => ({
  name: 'blockhaven-version',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) });
  },
});

export default defineConfig({
  base: './',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [versionFile()],
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 1200 },
  test: { environment: 'node' },
});
