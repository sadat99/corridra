import { expect, test } from '@playwright/test';

// D-013 (commercial-ready run, 23 Nov 2026): every page in the sitemap must carry the share image. Seven pages lost
// it because a page that sets its own share title replaces the whole share block of the root layout.
const meta = (html: string, property: string) =>
  new RegExp(`<meta property="${property}" content="([^"]*)"`).exec(html)?.[1];

test('every public page in the sitemap carries the share image', async ({ request }) => {
  const sitemap = await (await request.get('/sitemap.xml')).text();
  const paths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    ([, loc]) => new URL(loc).pathname,
  );
  expect(paths.length).toBeGreaterThan(12);
  for (const path of ['/how-it-works', '/trust', '/institutions', '/sell', '/source'])
    expect(paths).toContain(path);
  expect(paths).toContain('/enter-market');
  expect(paths).toContain('/trade-missions');

  const missing: string[] = [];
  const images = new Set<string>();
  for (const path of paths) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    const html = await response.text();
    const image = meta(html, 'og:image');
    if (!image || meta(html, 'og:image:width') !== '1200' || meta(html, 'og:type') !== 'website')
      missing.push(path);
    else images.add(new URL(image).pathname);
    expect(meta(html, 'og:title'), path).toBeTruthy();
  }
  expect(missing).toEqual([]);
  expect([...images]).toEqual(['/opengraph-image.png']);

  const file = await request.get('/opengraph-image.png');
  expect(file.status()).toBe(200);
  expect(file.headers()['content-type']).toContain('image/png');
});
