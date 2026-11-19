import { canonicalPageUrl } from '../lib/canonical-origin';
import { sitemapPaths } from '../lib/seo-paths';

export default function sitemap() {
  return sitemapPaths().map((path) => ({ url: canonicalPageUrl(path) }));
}
