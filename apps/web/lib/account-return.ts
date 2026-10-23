// Navigation only. This never grants access to a request or a workspace.
export function accountReturnTo(value: string | null | undefined) {
  return value === '/plan' ? '/plan' : '/account';
}

type AccessPage = '/signin' | '/signup' | '/verify-email' | '/forgot-password' | '/reset-password';
/** `method: 'code'` opens the sign-in page on its code option. It only applies to /signin. */
export function accountAccessPath(page: AccessPage, destination: string, method?: 'code') {
  const query = new URLSearchParams();
  if (accountReturnTo(destination) === '/plan') query.set('returnTo', '/plan');
  if (method === 'code' && page === '/signin') query.set('method', 'code');
  const text = query.toString();
  return text ? `${page}?${text}` : page;
}
