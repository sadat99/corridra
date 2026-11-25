import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { foundations } from '../../../lib/foundations';
import { ContributorSignout } from '../signout';
import { HelperMe } from './helper-me';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'My Assigned Work | Corridra',
  robots: { index: false, follow: false },
};

/** True when a helper session exists. Any failure reads as signed out (fail closed), as on the task page. */
async function hasSession(s: NonNullable<ReturnType<typeof foundations>>) {
  try {
    await s.ready;
    return !!(await s.provider.getSession(await headers()));
  } catch {
    return false;
  }
}
// The field helper's Me tab (Navigation v1, FieldHelper board): language, reading aloud, the private-link note and
// Sign Out in one place. Same access rule as the task page: a valid workspace link and a contributor session, and
// nothing about the workspace is read here. A control that is not real yet says Coming soon.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string }>;
}) {
  const s = foundations();
  const workspace = z.uuid().safeParse((await searchParams).workspace);
  if (!s || !workspace.success) {
    // Without a workspace link this page has nothing of the helper's to show. It says so and gives a real way on:
    // a signed-in helper can sign out here (the menu already leads to the task page); anyone else gets the helper
    // sign-in. The session check is the one this page already makes below; nothing else is read.
    const signedIn = s ? await hasSession(s) : false;
    return (
      <WorkspaceShell eyebrow="Assigned work" title="My Assigned Work" compact>
        {signedIn ? (
          <p role="status">
            <strong>You are signed in.</strong> Your settings open with your tasks.
          </p>
        ) : null}
        <p>
          Open the workspace link supplied with your reviewed invitation. A customer account does
          not grant assigned-task access.
        </p>
        {signedIn ? (
          <ContributorSignout />
        ) : (
          <Link prefetch={false} className="text-link" href="/contributor/signin">
            Helper Sign-In
          </Link>
        )}
      </WorkspaceShell>
    );
  }
  await s.ready;
  const identity = await s.provider.getSession(await headers());
  if (!identity)
    // The helper sign-in keeps only a task-page return (the closed list in lib/workspace-navigation.ts), so a
    // signed-out helper comes back to the task page of this workspace, where Me is one tab away.
    redirect(
      '/contributor/signin?next=' + encodeURIComponent('/contributor?workspace=' + workspace.data),
    );
  return (
    <WorkspaceShell eyebrow="Assigned work" title="My Assigned Work">
      <HelperMe workspace={workspace.data} />
      <ContributorSignout />
    </WorkspaceShell>
  );
}
