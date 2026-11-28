'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useT } from './language-provider';
import { SiteFooterV44 } from './site-footer-v44';
import { SiteFooterView } from './site-footer-view';
import { signedInShellFor } from '../lib/ux/shells';
import { isBarePublicPage } from '../lib/ux/bare-pages';
import { isQuiet } from './use-signed-in';

// Home page v4.3: the pack footer and its stylesheet load only while the switch is on, so an off build ships neither.
const SiteFooterPack = dynamic(() => import('./site-footer-pack').then((m) => m.SiteFooterPack));

/**
 * Chooses the footer for the page. `shells` is CORRIDRA_UX_SHELLS_V2, read on the server, the same switch the
 * header follows. With it on, a page inside a signed-in workspace shows no marketing footer, only a quiet line
 * with the copyright and the privacy notice, so the notice stays one click away. Public pages, the sign-in and
 * recovery pages and the staff customer preview keep the full footer, and with the switch off nothing changes.
 * `accessDoors` is CORRIDRA_UX_ACCESS_DOORS: it only changes the actions column of the full footer (see the view).
 */
export function SiteFooterPlace({
  realUse,
  shells,
  accessDoors = false,
  homeV42 = false,
  homeV43 = false,
  homeV44 = false,
}: {
  realUse: boolean;
  shells: boolean;
  /** CORRIDRA_UX_ACCESS_DOORS, read on the server: a signed-out visitor sees the three access doors in the footer. */
  accessDoors?: boolean;
  /** CORRIDRA_UX_HOME_V42, read on the server: the full footer is the trimmed one (owner, 25 Nov 2026). */
  homeV42?: boolean;
  /**
   * CORRIDRA_UX_HOME_V43, read on the server (owner, 26 Nov 2026, via the Guardian): the public footer takes the pack's
   * groups. It wins over V42. The request page (/plan) and the staff preview keep the trimmed footer.
   */
  homeV43?: boolean;
  /**
   * CORRIDRA_UX_HOME_V44, read on the server (live by default; owner, 28 Nov 2026): the home page's footer replaces
   * every footer below, on every page and also inside a signed-in workspace. Exactly "false" gives the footers of before.
   */
  homeV44?: boolean;
}) {
  const t = useT();
  const pathname = usePathname();
  if (isBarePublicPage(pathname)) return null;
  if (homeV44)
    return (
      <SiteFooterV44
        realUse={realUse}
        accessDoors={accessDoors}
        workspace={shells && !!signedInShellFor(pathname)}
      />
    );
  if (!shells || !signedInShellFor(pathname))
    return homeV43 && pathname !== '/plan' && !isQuiet(pathname) ? (
      <SiteFooterPack realUse={realUse} accessDoors={accessDoors} />
    ) : (
      <SiteFooterView
        realUse={realUse}
        accessDoors={accessDoors}
        trim={homeV42}
        {...(homeV43 ? { trimV43: true } : {})}
      />
    );
  return (
    <footer className="site-footer">
      {/* Owner decision, 12 Nov 2026 (locked mockups revision 2): the quiet footer gains How We Label Facts. */}
      <span>
        <Link prefetch={false} href="/trust">
          {t('footer.factsMore')}
        </Link>
      </span>
      <span>© 2026 Corridra</span>
      <span>
        <Link prefetch={false} href="/privacy">
          {realUse ? t('footer.privacy') : t('footer.privacyTest')}
        </Link>
      </span>
    </footer>
  );
}
