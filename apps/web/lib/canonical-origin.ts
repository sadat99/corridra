/**
 * The owned public address (ADR-034). Canonical links name it on every page, wherever the page was
 * served from, so search engines index one copy (CQ-17).
 */
export const canonicalSiteOrigin = 'https://c.obsidianglobal.studio';

/** Permanent, method-preserving redirect for page requests that reach another host (CQ-17). */
export const canonicalRedirectStatus = 308;

/**
 * Where a page request on another host of the production deployment (the hosting alias, a
 * deployment address) belongs: the configured production origin, with the same path and query.
 * Only GET and HEAD move; form posts are never redirected between origins. Previews, local runs and
 * requests already on the origin answer null.
 */
export function canonicalPageRedirect(request: Request, env: NodeJS.ProcessEnv = process.env) {
  if (
    env.VERCEL_ENV !== 'production' ||
    !env.APP_ORIGIN ||
    !['GET', 'HEAD'].includes(request.method)
  )
    return null;
  const destination = new URL(env.APP_ORIGIN);
  if (destination.protocol !== 'https:' || destination.origin !== env.APP_ORIGIN)
    throw new Error('An exact HTTPS application origin is required');
  const source = new URL(request.url);
  if (source.origin === destination.origin) return null;
  destination.pathname = source.pathname;
  destination.search = source.search;
  return destination;
}

/** The canonical address of a page: the owned origin plus the path, without query or fragment. */
export function canonicalPageUrl(pathname: string | null | undefined): string {
  const path = typeof pathname === 'string' && /^\/(?![/\\])/.test(pathname) ? pathname : '/';
  const url = new URL(path, canonicalSiteOrigin);
  return url.origin === canonicalSiteOrigin
    ? canonicalSiteOrigin + (url.pathname === '/' ? '' : url.pathname)
    : canonicalSiteOrigin;
}
