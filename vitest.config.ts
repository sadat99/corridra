import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: {
    // next/font/google only works inside a Next.js build; tests get a stand-in (tests/integration/support).
    alias: {
      'next/font/google': fileURLToPath(
        new URL('./tests/integration/support/next-font-google.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['tests/integration/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
