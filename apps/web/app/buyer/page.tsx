import { WorkspaceShell } from '../../components/workspace-shell';
import { AccessOptions } from '../../components/access-options';
import { accessHelp } from '../../lib/access-doors';
import type { Metadata } from 'next';
import { BuyerIntroduction } from './introduction';
import { uxSwitchOn } from '../../lib/ux-switches';
import { offeredLanguages } from '../../lib/i18n/locales';
export const metadata: Metadata = {
  title: 'Private introduction | Corridra',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};
export default function BuyerPage() {
  return (
    <WorkspaceShell
      eyebrow="Private introduction from Corridra"
      title="Would this company be relevant to you?"
    >
      <BuyerIntroduction
        replyPage={uxSwitchOn('CORRIDRA_REPLY_PAGE')}
        chineseReleased={offeredLanguages().some((language) => language.code === 'zh')}
      />
      <AccessOptions {...accessHelp.buyer} />
    </WorkspaceShell>
  );
}
