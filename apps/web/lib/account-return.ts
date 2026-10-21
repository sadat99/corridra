// Navigation only. This never grants access to a request or a workspace.
export function accountReturnTo(value: string | null | undefined) {
  return value === '/plan' ? '/plan' : '/account';
}

type AccessPage = '/signin' | '/signup' | '/verify-email' | '/forgot-password' | '/reset-password';
export function accountAccessPath(page: AccessPage, destination: string) {
  return accountReturnTo(destination) === '/plan' ? `${page}?returnTo=%2Fplan` : page;
}
