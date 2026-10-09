import { defineConfig, globalIgnores } from 'eslint/config';
import web from './apps/web/eslint.config.mjs';
export default defineConfig([
  ...web,
  { settings: { next: { rootDir: './apps/web' }, react: { version: '19.3' } } },
  globalIgnores([
    '**/.next/**',
    '**/node_modules/**',
    '.cache/**',
    'test-results/**',
    'playwright-report/**',
    'apps/web/next-env.d.ts',
    'apps/web/app/.well-known/workflow/**',
    'apps/web/.workflow-data/**',
  ]),
]);
