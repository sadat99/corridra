import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { corridorPages } from '../../apps/web/content/corridors';

// The static route list shared by the AC/1 UX gate (ux-gate.spec.ts) and the reading-level gate
// (readability.spec.ts), so both walk exactly the same pages. It is a plain module with no tests of its
// own: importing a spec file would register that spec's tests in the importing file.

const here = dirname(fileURLToPath(import.meta.url));
export const appDir = join(here, '..', '..', 'apps/web/app');

export function staticRoutes(directory: string): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (
        entry.startsWith('[') ||
        entry.startsWith('(') ||
        entry.startsWith('_') ||
        entry === 'api'
      )
        continue;
      if (entry.startsWith('.')) continue;
      routes.push(...staticRoutes(path));
    } else if (entry === 'page.tsx') {
      const route = '/' + relative(appDir, directory).split('\\').join('/');
      routes.push(route === '/' ? '/' : route.replace(/\/$/, ''));
    }
  }
  return routes.sort();
}

// Dynamic segments are skipped above, except the corridor pages that generateStaticParams() renders
// from content/corridors.ts: those are public static routes too.
export const generatedRoutes = Object.keys(corridorPages).map((slug) => `/corridors/${slug}`);

/** Every route the gates walk, in the order the UX gate has always used. */
export function gateRoutes(): string[] {
  return [...staticRoutes(appDir), ...generatedRoutes].sort();
}
