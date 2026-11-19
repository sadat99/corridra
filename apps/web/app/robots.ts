import type { MetadataRoute } from 'next';
import { canonicalPageUrl } from '../lib/canonical-origin';
import { robotsDisallowPaths } from '../lib/seo-paths';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: [...robotsDisallowPaths] }],
    sitemap: canonicalPageUrl('/sitemap.xml'),
  };
}
