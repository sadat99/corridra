/**
 * A preview can only be read. Any method other than GET or HEAD under the preview path is refused
 * before the application sees it, whatever the page does.
 */
export function viewAsMethodRefusal(request: Request) {
  const { pathname } = new URL(request.url);
  if (!/^\/operator\/view-as(\/|$)/.test(pathname)) return null;
  if (['GET', 'HEAD'].includes(request.method)) return null;
  return new Response(null, {
    status: 405,
    headers: {
      Allow: 'GET, HEAD',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
