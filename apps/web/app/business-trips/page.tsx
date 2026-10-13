import { PublicPage } from '../../components/public-page';
import { publicPages } from '../../content/public-pages';
const content = publicPages['business-trips'];
export const metadata = { title: `${content.label} | Corridra`, description: content.description };
export default function Page() {
  return <PublicPage content={content} />;
}
