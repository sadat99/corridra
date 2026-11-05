import type { ReactNode } from 'react';
import { ContributorFrame } from '../../components/ux/contributor-frame';
import { uxSwitchOn } from '../../lib/ux-switches';

/**
 * The contributor shell, behind CORRIDRA_UX_SHELLS_V2 like the header that carries its menu button.
 * With the switch off this layout adds nothing and every page renders exactly as before. The frame
 * is navigation only: each page and the server decide who sees what.
 */
export default function ContributorLayout({ children }: { children: ReactNode }) {
  if (!uxSwitchOn('CORRIDRA_UX_SHELLS_V2')) return children;
  return <ContributorFrame>{children}</ContributorFrame>;
}
