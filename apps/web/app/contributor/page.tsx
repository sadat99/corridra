import { WorkspaceShell } from '../../components/workspace-shell';
import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { FrontDoor } from '../../components/front-door';
import { foundations } from '../../lib/foundations';
import { helperDoor } from '../../lib/front-doors';
import { uxSwitchOn } from '../../lib/ux-switches';
import { ContributorSignout } from './signout';
import { TaskBoard } from './task-board';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Your assigned tasks | Corridra',
  robots: { index: false, follow: false },
};
/** True when a contributor identity session exists. Any failure reads as signed out (fail closed). */
async function signedIn(s: NonNullable<ReturnType<typeof foundations>>) {
  try {
    await s.ready;
    return !!(await s.provider.getSession(await headers()));
  } catch {
    return false;
  }
}
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string }>;
}) {
  const s = foundations();
  if (!s)
    return (
      <WorkspaceShell eyebrow="ASSIGNED EXECUTION WORK" title="Your assigned tasks." compact>
        <p>
          Assigned-task access is not configured in this environment. Keep the invitation supplied
          by your operator.
        </p>
        <Link className="text-link" href="/network">
          How assigned work works
        </Link>
        <Link className="text-link" href="/signin">
          Other sign-in options
        </Link>
        <Link className="text-link" href="/">
          Back to Corridra
        </Link>
      </WorkspaceShell>
    );
  const workspace = z.uuid().safeParse((await searchParams).workspace);
  // CQ-60: a person who finished setup and is signed in is told where they stand, instead of being
  // sent back to the invitation steps they already completed.
  if (!workspace.success && (await signedIn(s)))
    return (
      <WorkspaceShell eyebrow="ASSIGNED EXECUTION WORK" title="Your assigned tasks." compact>
        <p role="status">
          <strong>You’re set up. No tasks assigned yet.</strong>
        </p>
        <p>
          When the Corridra team assigns you a task, you get a link that opens it here with its
          instructions, deadline and the evidence it needs.
        </p>
        <Link className="text-link" href="/network">
          How assigned work works
        </Link>
        <ContributorSignout />
      </WorkspaceShell>
    );
  if (!workspace.success)
    return (
      <WorkspaceShell eyebrow="ASSIGNED EXECUTION WORK" title="Your assigned tasks." compact>
        <p>
          Open the workspace link supplied with your reviewed invitation. A customer account does
          not grant assigned-task access.
        </p>
        {uxSwitchOn('CORRIDRA_UX_FRONT_DOORS') ? (
          <FrontDoor label="Ways in for a helper" items={helperDoor} />
        ) : (
          <>
            <Link className="primary-link" href="/contributor/setup">
              Accept a reviewed contributor invitation
            </Link>
            <Link className="text-link" href="/network">
              How assigned work works
            </Link>
            <Link className="text-link" href="/signin">
              Choose your sign-in route
            </Link>
          </>
        )}
        <Link className="text-link" href="/">
          Back to Corridra
        </Link>
      </WorkspaceShell>
    );
  await s.ready;
  const identity = await s.provider.getSession(await headers());
  if (!identity)
    redirect(
      '/operator/signin?next=' + encodeURIComponent('/contributor?workspace=' + workspace.data),
    );
  return (
    <WorkspaceShell eyebrow="ASSIGNED EXECUTION WORK" title="Your assigned tasks.">
      <p>
        Only your disclosed tasks appear here. Follow each task’s instructions, deadlines and
        evidence requirements. Your access does not include the full mission or team workspace.
      </p>
      {process.env.CORRIDRA_NETWORK_ENABLED === 'true' ? (
        <TaskBoard workspace={workspace.data} />
      ) : (
        <p>The execution network is awaiting activation review. No work is currently available.</p>
      )}
      <Link
        className="text-link"
        href={
          '/operator/signin?next=' + encodeURIComponent('/contributor?workspace=' + workspace.data)
        }
        target="_blank"
        rel="noopener noreferrer"
      >
        Verify your authenticator again (opens a new tab)
      </Link>
      <p>Keep this task page open while verifying so unreceived work remains available to retry.</p>
      <Link className="text-link" href="/network">
        About assigned work
      </Link>
      {process.env.CORRIDRA_NETWORK_ENABLED !== 'true' && <ContributorSignout />}
    </WorkspaceShell>
  );
}
