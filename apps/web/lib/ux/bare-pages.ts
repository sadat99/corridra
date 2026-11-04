// Pages that show nothing but their own content: no site header, no footer, no help dock. A page for someone
// without an account that carries a private link must not load anything that asks the server who is signed in,
// so none of that chrome may render there. One list, one test; every piece of shared chrome uses this predicate.
export const barePublicPages = ['/decision-card'] as const;

export function isBarePublicPage(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return (barePublicPages as readonly string[]).includes(path);
}
