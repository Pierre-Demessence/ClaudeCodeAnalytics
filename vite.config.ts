import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

import { apiPlugin } from './src/server/api.ts';

const brand = JSON.parse(readFileSync(resolve(import.meta.dirname, 'brand.json'), 'utf8')) as { name: string };

export default defineConfig({
  build: {
    // Served from localhost only, so bundle size does not matter (Recharts alone is ~500 kB).
    chunkSizeWarningLimit: 1500,
  },
  plugins: [
    react(),
    apiPlugin(),
    {
      name: 'inject-brand',
      transformIndexHtml: (html: string) => html.replaceAll('%APP_NAME%', () => brand.name),
    },
  ],
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: resolve(import.meta.dirname, 'src/$1') },
    ],
  },
});
