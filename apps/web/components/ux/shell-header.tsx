'use client';
// Chooses the header for the page (D14). With CORRIDRA_UX_SHELLS_V2 on, a signed-in page (team,
// customer or contributor) gets its shell's own header and never the public marketing header. Off,
// or on a public page, it is the public header exactly as before. Owner: WS-E.
import { usePathname } from 'next/navigation';
import { BrandMark, SiteHeader } from '../site-header';
import { signedInShellFor } from '../../lib/ux/shells';
import { AppHeader } from './app-header';

export function ShellHeader({
  shells,
  notifications,
  live,
  accounts,
  mode,
}: {
  /** CORRIDRA_UX_SHELLS_V2, read on the server. */
  shells: boolean;
  /** CORRIDRA_NOTIFICATIONS_V2: the signed-in header shows the inbox. */
  notifications: boolean;
  /** True on the production service: the team header says "Live", elsewhere "Preview". */
  live: boolean;
  accounts?: boolean;
  mode?: 'sample' | 'real';
}) {
  const pathname = usePathname();
  const shell = shells ? signedInShellFor(pathname) : null;
  if (shell)
    return (
      <AppHeader kind={shell} live={live} notifications={notifications} brandMark={<BrandMark />} />
    );
  return <SiteHeader accounts={accounts} mode={mode} />;
}
