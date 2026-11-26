import { HowItWorksV43Page } from '../../components/how-trust-v43-page';
import { HomeFaqMore, HomeMissionMore, HomeRoutesMore } from '../../components/home-more';
import { PublicPage } from '../../components/public-page';
import { PublicShell } from '../../components/public-shell';
import { publicPages } from '../../content/public-pages';
import { howTrustV43On } from '../../lib/how-trust-v43';
import { pageOpenGraph } from '../../lib/ux/page-metadata';
const content = publicPages['how-it-works'];
export const metadata = {
  title: `${content.label.toLowerCase().replace(/^./, (c) => c.toUpperCase())} | Corridra`,
  description: content.description,
  openGraph: pageOpenGraph(content.title, content.description),
};
// With CORRIDRA_UX_HOW_TRUST_V43 on (owner, 26 Nov 2026, first hand to Guardian G66: "yes to all three, build it") the
// page is the whole process on one page, loaded by HowItWorksV43Page only then. Off, it is the page it was.
export default function Page() {
  if (howTrustV43On())
    return (
      <PublicShell className="ux-guide-home ac1-home tr-home">
        <HowItWorksV43Page />
      </PublicShell>
    );
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
