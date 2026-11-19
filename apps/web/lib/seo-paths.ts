import { corridorPages } from '../content/corridors';

/**
 * Search visibility (owner decision, 19 November 2026): engines may index the public pages only.
 * The sitemap lists exactly these static pages plus the corridor pages. A page is added here only when it is a
 * public landing page with no sign-in, no switch and no noindex rule; when in doubt it stays out.
 */
export const publicSitemapPaths: readonly string[] = [
  '/',
  '/how-it-works',
  '/about',
  '/trust',
  '/privacy',
  '/corridors',
  '/source',
  '/machinery',
  '/sell',
  '/enter-market',
  '/trade-missions',
  '/business-trips',
  '/institutions',
];

export function sitemapPaths(): string[] {
  return [...publicSitemapPaths, ...Object.keys(corridorPages).map((slug) => `/corridors/${slug}`)];
}

/**
 * Signed-in, staff, token and programme-page areas crawlers are asked to stay out of. The same areas carry
 * their own noindex rules (next.config.ts, ADR-080); robots.txt is an extra request, never the protection.
 */
export const robotsDisallowPaths: readonly string[] = [
  '/account',
  '/operator',
  '/api',
  '/contributor',
  '/access',
  '/workspace',
  '/client',
  '/buyer',
  '/decision-card',
  '/delegations',
  '/reply',
  '/mute',
  '/pulse',
  '/signin',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
];
