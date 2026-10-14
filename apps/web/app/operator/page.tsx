import Link from 'next/link';
import { WorkspaceShell } from '../../components/workspace-shell';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { foundations } from '../../lib/foundations';
import { Workspace } from './workspace';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Operator workspace | Corridra',
  robots: { index: false, follow: false },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string }>;
}) {
  const s = foundations();
  if (!s)
    return (
      <WorkspaceShell eyebrow="OPERATOR WORKSPACE" title="Workspace access is unavailable.">
        <p>The protected workspace is not configured in this environment.</p>
        <Link className="text-link" href="/signin">
          Other sign-in options
        </Link>
        <Link className="text-link" href="/">
          Back to Corridra
        </Link>
      </WorkspaceShell>
    );
  await s.ready;
  const requested = (await searchParams).workspace;
  const identity = await s.provider.getSession(await headers());
  if (!identity) {
    const destination =
      requested && /^[0-9a-f-]{36}$/i.test(requested)
        ? '/operator?workspace=' + requested
        : '/operator';
    redirect('/operator/signin?next=' + encodeURIComponent(destination));
  }
  const tenants = await s.access.tenants(identity.token);
  const selected = tenants.find((t) => t.id === requested)?.id ?? tenants[0]?.id;
  if (tenants.length === 0)
    return (
      <WorkspaceShell eyebrow="OPERATOR WORKSPACE" title="Workspace access is unavailable.">
        <p>Your session needs a current authenticator check and an active membership.</p>
        <p>
          Ask your workspace owner to confirm the invitation and your assigned role. A customer
          account uses a separate sign-in and does not grant operator membership.
        </p>
        <Link className="text-link" href="/workspace">
          Choose your workspace or tool
        </Link>
        <p>
          Invited contributors use their assigned-task link, which does not grant workspace
          membership.
        </p>
        <Link className="text-link" href="/contributor">
          Assigned-task invitation help
        </Link>
        <Link className="text-link" href="/signin">
          Other sign-in options
        </Link>
        <Link className="text-link" href="/operator/signin">
          Verify your access
        </Link>
      </WorkspaceShell>
    );
  return (
    <WorkspaceShell eyebrow="OPERATOR WORKSPACE" title="Your workspace.">
      <Workspace tenants={tenants} initialTenant={selected!} />
    </WorkspaceShell>
  );
}
