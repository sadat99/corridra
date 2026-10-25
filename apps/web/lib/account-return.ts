// Navigation only. This never grants access to a request or a workspace.
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
// The exact pages an email may send a person back to after sign-in (ADR-067). Each is a whole path: no
// query, no fragment, no scheme, no host. A page still checks who is signed in before it shows anything.
const emailDestinations = [
  /^\/plan$/,
  /^\/account\/move$/,
  /^\/account\/notifications$/,
  new RegExp(`^/account/requests/${uuid}$`),
  new RegExp(`^/account/rooms/${uuid}$`),
];

/**
 * Where to go after sign-in. By default only the request form is kept, as it always was. With `extended`
 * (the server passes it while Pulse is on) the short list of exact email destinations is kept too.
 */
export function accountReturnTo(value: string | null | undefined, extended = false) {
  if (value === '/plan') return '/plan';
  if (
    extended &&
    typeof value === 'string' &&
    value.length <= 80 &&
    /^[a-z0-9/-]+$/.test(value) &&
    !value.includes('//') &&
    !value.includes('..') &&
    emailDestinations.some((pattern) => pattern.test(value))
  )
    return value;
  return '/account';
}

type AccessPage = '/signin' | '/signup' | '/verify-email' | '/forgot-password' | '/reset-password';
/** `method: 'code'` opens the sign-in page on its code option. It only applies to /signin. */
export function accountAccessPath(
  page: AccessPage,
  destination: string,
  method?: 'code',
  extended = false,
) {
  const query = new URLSearchParams();
  const kept = accountReturnTo(destination, extended);
  if (kept !== '/account') query.set('returnTo', kept);
  if (method === 'code' && page === '/signin') query.set('method', 'code');
  const text = query.toString();
  return text ? `${page}?${text}` : page;
}
