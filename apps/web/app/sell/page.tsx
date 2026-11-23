import { PublicPage } from '../../components/public-page';
import { publicPages } from '../../content/public-pages';
import { pageOpenGraph } from '../../lib/ux/page-metadata';
const content = publicPages['sell'];
export const metadata = {
  title: `${content.label.toLowerCase().replace(/^./, (c) => c.toUpperCase())} | Corridra`,
  description: content.description,
  openGraph: pageOpenGraph(content.title, content.description),
};
export default function Page() {
  return <PublicPage content={content} />;
}
