import type { MetadataRoute } from 'next';
import { canonicalPageUrl } from '../lib/canonical-origin';
import { sitemapPaths } from '../lib/seo-paths';

export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapPaths().map((path) => ({ url: canonicalPageUrl(path) }));
}
