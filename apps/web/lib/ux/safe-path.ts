// Navigation targets from stored data (commercial readiness program). Owner: WS-E.
/** Only a same-site path is followed; anything else (another host, a scheme, //host) is ignored. */
export function safeInternalPath(href: unknown): string | null {
  if (typeof href !== 'string' || !/^\/(?![/\\])/.test(href)) return null;
  try {
    const url = new URL(href, 'https://internal.invalid');
    return url.origin === 'https://internal.invalid' ? url.pathname + url.search + url.hash : null;
  } catch {
    return null;
  }
}
