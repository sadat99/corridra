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
