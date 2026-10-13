import { defineConfig, globalIgnores } from 'eslint/config';
import web from './apps/web/eslint.config.mjs';
export default defineConfig([
  ...web,
  {
    files: ['apps/web/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'],
    ignores: ['packages/intelligence/src/adapters.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['ai', 'ai/*', '@ai-sdk/*'],
              message:
                'Provider SDKs belong only in packages/intelligence/src/adapters.ts; business services call registered gateway tasks.',
            },
          ],
        },
      ],
    },
  },
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
