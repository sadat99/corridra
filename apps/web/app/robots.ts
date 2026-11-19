import { canonicalPageUrl } from '../lib/canonical-origin';
import { robotsDocument } from '../lib/seo-paths';

export default function robots() {
  return robotsDocument(canonicalPageUrl('/sitemap.xml'));
}
