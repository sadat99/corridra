import {
  offlineServiceWorkerScript,
  retiredServiceWorkerScript,
  serviceWorkerOn,
} from '../../lib/ux/service-worker';

/**
 * The service worker as a same-origin file at the root, so its scope is the whole site (CQ-10 serves the
 * language boot script the same way). Its body is fixed text built in `lib/ux/service-worker.ts` and never
 * from request data.
 *
 * Never held: the worker file itself carries `no-store`, so a browser always asks the server for it and the
 * owner's retirement setting reaches an installed browser on its next check. The product's own caching is
 * untouched.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  const script = serviceWorkerOn() ? offlineServiceWorkerScript() : retiredServiceWorkerScript();
  return new Response(script, {
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
      'Service-Worker-Allowed': '/',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
