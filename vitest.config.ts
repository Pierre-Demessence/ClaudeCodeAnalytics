import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: resolve(__dirname, 'src/$1') },
    ],
  },
  test: {
    // Node-side tests opt out per file with `// @vitest-environment node`.
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      exclude: ['src/**/*.test.{ts,tsx}', 'src/dashboard/main.tsx', 'src/collector/cli.ts'],
      include: ['src/**/*.{ts,tsx}'],
      provider: 'v8',
    },
  },
});
