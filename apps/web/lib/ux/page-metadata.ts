// Each route sets a unique title and one H1 (commercial readiness program, 5.2). Owner: WS-E.
// No import from 'next' here: the shared package type check would pick up Next's global types.
export function pageMetadata<T extends object = Record<never, never>>(
  title: string,
  extra?: T,
): T & { title: string } {
  const clean = title.trim();
  return { ...(extra ?? ({} as T)), title: clean === 'Corridra' ? clean : `${clean} | Corridra` };
}

/** Team pages are never indexed. */
export function privatePageMetadata(title: string) {
  return pageMetadata(title, { robots: { index: false, follow: false } });
}
