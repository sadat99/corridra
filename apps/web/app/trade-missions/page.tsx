import { customerProgrammePagesEnabled } from '@corridra/auth/customer-programme-publication';
import { PublicPage } from '../../components/public-page';
import { publicPages } from '../../content/public-pages';
import { OrganiseEntry } from './organise-entry';
const content = publicPages['trade-missions'];
export const metadata = {
  title: `${content.label.toLowerCase().replace(/^./, (c) => c.toUpperCase())} | Corridra`,
  description: content.description,
  openGraph: { title: content.title, description: content.description },
};
// The switch is read when the page is asked for, not when it is built, so turning it on or off needs no new build.
export const dynamic = 'force-dynamic';
export default function Page() {
  return (
    <PublicPage
      content={content}
      after={customerProgrammePagesEnabled() ? <OrganiseEntry /> : null}
    />
  );
}
