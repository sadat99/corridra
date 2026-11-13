/**
 * The installed application's service worker, as text, and the one setting that retires it.
 *
 * What the worker does, and nothing else (owner directive, 13 November 2026): it answers a page the browser
 * could not fetch with one branded offline page, so an installed Corridra says plainly that it cannot
 * connect instead of showing the browser's error. It never stores a copy of the product.
 *
 * What it never does: it never caches a response, never touches anything but GET, never answers a request
 * the page makes for data, and never keeps a page, an API answer, an account, money, identity or any other
 * private content. The only things it holds are the public `/offline` page and the stylesheets that page
 * itself links, fetched once at install with no credentials. Because nothing of the product is cached, a new
 * deployment cannot be broken by an old worker: every real page still comes from the network.
 */

/** The cache this worker owns. Raise the number to retire the previous one on the next activation. */
export const offlineCacheName = 'corridra-offline-v1';

/** The page an installed Corridra shows when the network cannot be reached. */
export const offlinePagePath = '/offline';

/**
 * Whether the browser is asked to register the worker and whether `/sw.js` serves it.
 *
 * On in a production build unless the owner sets `CORRIDRA_PWA_SERVICE_WORKER` to exactly "false". That
 * setting is the recovery path: a Git or Vercel rollback cannot reach a worker a browser has already
 * installed, so turning it off serves the retirement worker below instead, which clears the caches this
 * worker owns and unregisters itself on every browser that asks for the file again. Development and test
 * builds never register one (`next dev` is not a production build).
 */
export function serviceWorkerOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production' && env.CORRIDRA_PWA_SERVICE_WORKER !== 'false';
}

/**
 * The worker that answers a failed page load with the offline page.
 *
 * Install fetches the offline page and its own stylesheets. Activation drops every older Corridra cache and
 * takes over open pages, which is safe here because the worker serves no page of the product from a cache:
 * nothing a person is reading is replaced and no unsaved work is discarded.
 */
export function offlineServiceWorkerScript(): string {
  return `// Corridra offline fallback worker. Source: apps/web/lib/ux/service-worker.ts
const CACHE = ${JSON.stringify(offlineCacheName)};
const OFFLINE = ${JSON.stringify(offlinePagePath)};

/** The offline page and the stylesheets it links. Public, same origin, fetched without credentials. */
async function precache() {
  const cache = await caches.open(CACHE);
  const page = await fetch(OFFLINE, { cache: 'reload', credentials: 'omit' });
  if (!page.ok) throw new Error('the offline page could not be read');
  const html = await page.clone().text();
  await cache.put(OFFLINE, page);
  const styles = [];
  for (const tag of html.match(/<link\\b[^>]*>/g) || []) {
    if (!/rel="stylesheet"/.test(tag)) continue;
    const href = /href="([^"]+)"/.exec(tag);
    if (href && href[1].startsWith('/_next/static/')) styles.push(href[1]);
  }
  await Promise.all(
    styles.map(async (href) => {
      const file = await fetch(href, { cache: 'reload', credentials: 'omit' });
      if (file.ok) await cache.put(href, file);
    }),
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith('corridra-') && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const page = request.mode === 'navigate';
  // Only a page the person asked for, or a stylesheet of the offline page, is ever answered from here.
  if (!page && !url.pathname.startsWith('/_next/static/')) return;
  event.respondWith(
    (async () => {
      try {
        // Every answer comes from the network and none of it is kept.
        return await fetch(request);
      } catch (error) {
        const cache = await caches.open(CACHE);
        const held = await cache.match(page ? OFFLINE : request);
        if (held) return held;
        throw error;
      }
    })(),
  );
});
`;
}

/**
 * The retirement worker, served when the setting is "false". It clears the caches this worker owns and
 * unregisters itself, so a browser that already installed a defective worker heals when it next asks for the
 * file. It does not reload anyone's page, so nothing unsaved is lost; the page stops being controlled at its
 * next navigation.
 */
export function retiredServiceWorkerScript(): string {
  return `// Corridra service worker retired by CORRIDRA_PWA_SERVICE_WORKER=false.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith('corridra-')) await caches.delete(key);
      await self.registration.unregister();
    })(),
  );
});
`;
}
