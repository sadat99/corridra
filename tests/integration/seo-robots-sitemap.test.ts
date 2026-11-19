import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import robots from '../../apps/web/app/robots';
import sitemap from '../../apps/web/app/sitemap';
import { canonicalSiteOrigin } from '../../apps/web/lib/canonical-origin';

const app = join(__dirname, '../../apps/web/app');
const urls = () => sitemap().map((entry) => entry.url);
const paths = () => urls().map((url) => new URL(url).pathname);

test('robots.txt and sitemap.xml routes exist', () => {
  expect(existsSync(join(app, 'robots.ts'))).toBe(true);
  expect(existsSync(join(app, 'sitemap.ts'))).toBe(true);
});

test('robots.txt blocks signed-in, staff and token areas and names the sitemap', () => {
  const rules = [robots().rules].flat()[0];
  const disallow = [rules.disallow].flat();
  for (const path of [
    '/account',
    '/operator',
    '/api',
    '/contributor',
    '/reply',
    '/mute',
    '/delegations',
    '/access',
    '/workspace',
    '/client',
    '/buyer',
    '/decision-card',
    '/pulse',
    '/signin',
    '/signup',
  ])
    expect(disallow).toContain(path);
  expect(robots().sitemap).toBe(`${canonicalSiteOrigin}/sitemap.xml`);
});

test('every robots block matches a real top-level route or a documented noindex area', () => {
  const routes = new Set(readdirSync(app));
  const disallow = [[robots().rules].flat()[0].disallow].flat() as string[];
  const unmatched = disallow
    .filter((p) => !p.endsWith('/'))
    .filter((p) => !routes.has(p.slice(1)) && !['/reply'].includes(p));
  expect(unmatched).toEqual([]);
});

test('sitemap lists only public pages on the owned origin', () => {
  expect(paths()).toEqual(
    expect.arrayContaining(['/', '/how-it-works', '/corridors/bangladesh-china']),
  );
  for (const url of urls()) expect(url.startsWith(`${canonicalSiteOrigin}`)).toBe(true);
  expect(new Set(urls()).size).toBe(urls().length);
});

test('no signed-in, staff, token, query or dynamic link is ever in the sitemap', () => {
  const blocked = [[robots().rules].flat()[0].disallow].flat() as string[];
  for (const url of urls()) {
    const u = new URL(url);
    expect(u.search + u.hash).toBe('');
    expect(u.pathname).not.toMatch(/[\[\]{}:?#]|token|\.ics$/i);
    for (const b of blocked) {
      const root = b.replace(/\/$/, '');
      expect(u.pathname === root || u.pathname.startsWith(`${root}/`)).toBe(false);
    }
    for (const extra of ['/plan', '/programme', '/fairs', '/network', '/install', '/offline'])
      expect(u.pathname.startsWith(extra)).toBe(false);
  }
});

test('every sitemap page is a real page that does not set noindex', () => {
  for (const path of paths()) {
    if (path.startsWith('/corridors/')) continue;
    const file = join(app, path === '/' ? '' : path, 'page.tsx');
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).not.toMatch(/index:\s*false/);
  }
});
