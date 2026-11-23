// Each route sets a unique title and one H1 (commercial readiness program, 5.2). Owner: WS-E.
// No import from 'next' here: the shared package type check would pick up Next's global types.
export function pageMetadata<T extends object = Record<never, never>>(
  title: string,
  extra?: T,
): T & { title: string } {
  const clean = title.trim();
  return { ...(extra ?? ({} as T)), title: clean === 'Corridra' ? clean : `${clean} | Corridra` };
}

/** The share image the root layout serves from `app/opengraph-image.png` (1200 by 630, words in the `.alt.txt` beside it). */
export const siteShareImage = {
  url: '/opengraph-image.png',
  width: 1200,
  height: 630,
  alt: 'Corridra, cross-border market access.',
  type: 'image/png',
} as const;

/**
 * The share block for a page that sets its own share title. Next replaces the whole `openGraph` block of the root
 * layout when a page sets one (metadata is merged one level deep only), so the image, type and locale the layout
 * carries are repeated here. The address is resolved against the layout's `metadataBase`.
 */
export function pageOpenGraph(title: string, description: string) {
  return {
    title,
    description,
    type: 'website' as const,
    locale: 'en_GB',
    images: [{ ...siteShareImage }],
  };
}

/** Team pages are never indexed. */
export function privatePageMetadata(title: string) {
  return pageMetadata(title, { robots: { index: false, follow: false } });
}
