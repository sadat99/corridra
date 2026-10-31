import { NextResponse, type NextRequest } from 'next/server';
import { canonicalPageRedirect, canonicalRedirectStatus } from './lib/canonical-origin';
import { viewAsMethodRefusal } from './lib/view-as-gate';

export function proxy(request: NextRequest) {
  const refused = viewAsMethodRefusal(request);
  if (refused) return refused;
  // Every page on another host of the production deployment moves to the owned address with its
  // path and query (CQ-17). API routes, assets and files are not matched below, so provider
  // callbacks issued for the old alias keep working (ADR-034).
  const destination = canonicalPageRedirect(request);
  if (!destination) return NextResponse.next();
  const response = NextResponse.redirect(destination, canonicalRedirectStatus);
  // Not cached: a rollback of the production origin must not leave browsers looping.
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

export const config = {
  // Pages only: not /api, not Next assets, not /.well-known and not any path ending in a file name.
  matcher: ['/((?!api/|_next/|\\.well-known/|[^?]*\\.[A-Za-z0-9]+$).*)'],
};
