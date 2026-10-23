import { NextResponse, type NextRequest } from 'next/server';
import { canonicalPageRedirect } from './lib/canonical-origin';

export function proxy(request: NextRequest) {
  const destination = canonicalPageRedirect(request);
  if (!destination) return NextResponse.next();
  const response = NextResponse.redirect(destination, 307);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

export const config = {
  matcher: [
    '/signup',
    '/signin',
    '/verify-email',
    '/forgot-password',
    '/reset-password',
    '/account/:path*',
    '/operator/:path*',
    '/contributor/:path*',
    '/plan',
    '/client',
    '/programme',
    '/buyer',
    '/mute/:path*',
  ],
};
