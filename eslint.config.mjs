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
  {
    // Every next/link Link keeps prefetch={false} (W10): a Link that prefetches fetches its target in the
    // background, on every page view, on a metered connection. The import must stay `import Link from
    // 'next/link'` so the Link selector below cannot be bypassed by an alias.
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'JSXOpeningElement[name.name="Link"]:not(:has(> JSXAttribute[name.name="prefetch"][value.expression.value=false]))',
          message:
            'Every next/link Link needs prefetch={false}, so a page never fetches other pages in the background.',
        },
        {
          selector:
            'ImportDeclaration[source.value="next/link"] > :matches(ImportDefaultSpecifier[local.name!="Link"], ImportNamespaceSpecifier, ImportSpecifier)',
          message:
            "Import next/link only as `import Link from 'next/link'`, so the prefetch={false} rule can see every Link.",
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
