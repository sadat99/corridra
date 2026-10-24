import { notFound } from 'next/navigation';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { CustomerShell } from '../../../components/customer-shell';
import { customerPageSession } from '../../../lib/customer-page-session';
import { buildMoveModel } from '../../../lib/move-cards';
import { loadMoveInput } from '../../../lib/move-loader';
import { uxSwitchOn } from '../../../lib/ux-switches';
import { AccountHashRedirect } from '../hash-redirect';
import { MoveView } from './move-view';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = {
  title: 'Your Move | Corridra',
  robots: { index: false, follow: false },
};

/**
 * Your Move: the front door for a signed-in customer. One list of what is waiting for the person,
 * and what somebody else holds. It reads the records the customer screens already read, adds none and
 * invents none. Behind `CORRIDRA_UX_MOVE`: with the switch off this address does not exist.
 */
export default async function Page() {
  if (!uxSwitchOn('CORRIDRA_UX_MOVE')) notFound();
  const session = await customerPageSession();
  if (!session.ok)
    return (
      <WorkspaceShell eyebrow="YOUR ACCOUNT" title="Your Move is unavailable." compact>
        <p role="status">{session.message}</p>
        <a className="text-link" href="/account">
          Return to your account
        </a>
      </WorkspaceShell>
    );

  const loaded = await loadMoveInput(session.subject, session.issuer);
  const model = buildMoveModel(loaded.input);
  const startHref = loaded.requestCreationEnabled
    ? '/account?view=work#customer-workspaces'
    : '/plan';
  return (
    <CustomerShell tab="move" eyebrow="YOUR MOVE" title="Here is what is waiting for you.">
      <AccountHashRedirect view="move" />
      <MoveView model={model} startHref={startHref} skippedWorkspaces={loaded.skippedWorkspaces} />
    </CustomerShell>
  );
}
