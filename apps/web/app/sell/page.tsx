import { PublicPage } from '../../components/public-page';
import { publicPages } from '../../content/public-pages';
const content = publicPages['sell'];
export const metadata = {
  title: `${content.label.toLowerCase().replace(/^./, (c) => c.toUpperCase())} | Corridra`,
  description: content.description,
  openGraph: { title: content.title, description: content.description },
};
export default function Page() {
  return <PublicPage content={content} />;
}
