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

/** The start of every cache this worker owns. Activation deletes each cache with this prefix that is not its own. */
export const offlineCachePrefix = 'corridra-offline-';

/** The identifier used when the platform gives no deployment identifier (local and test builds). */
export const unknownDeploymentId = 'local';

/**
 * The identifier of the deployment that is serving this file: the Git commit of the deployment, else the
 * platform's deployment identifier, else a fixed word. It is read only from the server's environment, never
 * from request data, and is reduced to letters, digits, hyphen and underscore (at most 40 characters) so it
 * can sit in a file name and a comment without changing what the worker does. One deployment always
 * answers with the same identifier, so a browser that asks twice receives identical bytes and installs
 * nothing new; the next deployment answers with a different one, so the browser installs the new worker.
 */
export function deploymentId(env: NodeJS.ProcessEnv = process.env): string {
  for (const candidate of [env.VERCEL_GIT_COMMIT_SHA, env.VERCEL_DEPLOYMENT_ID]) {
    const id = (candidate ?? '').trim();
    if (/^[A-Za-z0-9_-]{1,40}$/.test(id)) return id;
  }
  return unknownDeploymentId;
}

/** Any other text given where an identifier is expected is replaced by the fixed word, never written into the worker. */
function safeId(id: string): string {
  return /^[A-Za-z0-9_-]{1,40}$/.test(id) ? id : unknownDeploymentId;
}

/** The cache one deployment's worker owns. A new deployment names a new cache and so refreshes the offline page. */
export function offlineCacheName(id: string = deploymentId()): string {
  return `${offlineCachePrefix}${safeId(id)}`;
}

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
 * The text carries the deployment identifier, so each deployment is a new worker: the browser installs it,
 * fetches a fresh offline page and stylesheets, and activation drops the previous deployment's cache.
 * Install fetches the offline page and its own stylesheets. Activation drops every older Corridra cache and
 * takes over open pages, which is safe here because the worker serves no page of the product from a cache:
 * nothing a person is reading is replaced and no unsaved work is discarded.
 */
export function offlineServiceWorkerScript(id: string = deploymentId()): string {
  return `// Corridra offline fallback worker. Source: apps/web/lib/ux/service-worker.ts
// Deployment ${safeId(id)}: every deployment serves different text, so an installed app updates itself.
const CACHE = ${JSON.stringify(offlineCacheName(id))};
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
