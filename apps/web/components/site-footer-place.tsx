'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useT } from './language-provider';
import { SiteFooterView } from './site-footer-view';
import { signedInShellFor } from '../lib/ux/shells';
import { isBarePublicPage } from '../lib/ux/bare-pages';

/**
 * Chooses the footer for the page. `shells` is CORRIDRA_UX_SHELLS_V2, read on the server, the same switch the
 * header follows. With it on, a page inside a signed-in workspace shows no marketing footer, only a quiet line
 * with the copyright and the privacy notice, so the notice stays one click away. Public pages, the sign-in and
 * recovery pages and the staff customer preview keep the full footer, and with the switch off nothing changes.
 */
export function SiteFooterPlace({ realUse, shells }: { realUse: boolean; shells: boolean }) {
  const t = useT();
  const pathname = usePathname();
  if (isBarePublicPage(pathname)) return null;
  if (!shells || !signedInShellFor(pathname)) return <SiteFooterView realUse={realUse} />;
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
