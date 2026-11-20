import { WorkspaceShell } from '../../components/workspace-shell';
import type { Metadata } from 'next';
import { DeliveryView } from '../delivery-view';
import { uxSwitchOn } from '../../lib/ux-switches';
export const metadata: Metadata = {
  title: 'Your mission | Corridra',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};
export default function ClientPage() {
  return (
    <WorkspaceShell eyebrow="Private mission progress" title="Your next commercial step">
      <DeliveryView audience="CLIENT_PROGRESS" beforeSend={uxSwitchOn('CORRIDRA_UX_BEFORE_SEND')} />
    </WorkspaceShell>
  );
}
