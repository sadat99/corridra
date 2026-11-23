import { HomeFaqMore, HomeMissionMore, HomeRoutesMore } from '../../components/home-more';
import { PublicPage } from '../../components/public-page';
import { publicPages } from '../../content/public-pages';
import { pageOpenGraph } from '../../lib/ux/page-metadata';
const content = publicPages['how-it-works'];
export const metadata = {
  title: `${content.label.toLowerCase().replace(/^./, (c) => c.toUpperCase())} | Corridra`,
  description: content.description,
  openGraph: pageOpenGraph(content.title, content.description),
};
export default function Page() {
  return (
    <PublicPage
      content={content}
      more={
        <>
          <HomeMissionMore />
          <HomeRoutesMore />
        </>
      }
      moreAfter={<HomeFaqMore />}
    />
  );
}
