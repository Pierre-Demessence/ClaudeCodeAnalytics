import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: { emptyOutDir: true, outDir: resolve(import.meta.dirname, 'dist-widget'), target: 'es2022' },
  clearScreen: false,
  root: resolve(import.meta.dirname, 'src/widget'),
  server: { host: '127.0.0.1', port: 1421, strictPort: true },
});
