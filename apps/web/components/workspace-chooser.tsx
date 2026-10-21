import Link from 'next/link';
import { redirect } from 'next/navigation';
import { DomainError } from '@corridra/domain';
import { foundations } from '../lib/foundations';

const destinations = {
  profile: {
    path: 'profile',
    description: 'Your company details, supporting statements and reviewed company links.',
  },
  programmes: {
    path: 'delegations',
    description: 'Programme participants, terms, places, fee schedules and delivery.',
  },
  services: {
    path: 'service-requests',
    description: 'Help requests, questions and quotes for work in this workspace.',
  },
} as const;
/** A choice of workspace grants nothing; destination APIs repeat the fresh identity and role checks. */
export async function WorkspaceChooser({
  kind,
  enabled,
}: {
  kind: keyof typeof destinations;
  enabled: boolean;
}) {
  if (!enabled)
    return (
      <p role="status">
        This feature is unavailable.{' '}
        <Link className="text-link" prefetch={false} href="/account">
          Return to your account
        </Link>
        .
      </p>
    );
  const s = foundations();
  if (!s)
    return (
      <p role="status">
        Your workspaces could not be loaded. Return to your account and try again.
      </p>
    );
  let workspaces;
  try {
    await s.ready;
    workspaces = await s.customerWorkspaces.list();
  } catch (error) {
    if (error instanceof DomainError && error.status === 401) redirect('/signin');
    if (
      error instanceof DomainError &&
      error.status === 403 &&
      error.message === 'Verify your email to continue'
    )
      redirect('/verify-email');
    return (
      <p role="status">
        Your workspaces could not be loaded.{' '}
        <Link className="text-link" prefetch={false} href="/account">
          Return to your account
        </Link>
        .
      </p>
    );
  }
  const visible =
    kind === 'programmes'
      ? workspaces.filter((workspace) => ['owner', 'admin'].includes(workspace.role))
      : workspaces;
  return (
    <section aria-labelledby="workspace-choice-title">
      <h2 id="workspace-choice-title">Choose a workspace</h2>
      <p>{destinations[kind].description}</p>
      {visible.length ? (
        <ul className="ux-quick-links">
          {visible.map((workspace) => (
            <li key={workspace.id}>
              <Link
                prefetch={false}
                href={
                  '/account/' + destinations[kind].path + '/' + encodeURIComponent(workspace.id)
                }
              >
                <strong>{workspace.name}</strong>
                <span>
                  {workspace.synthetic ? 'Example workspace. ' : ''}
                  {workspace.role === 'owner'
                    ? 'You own this workspace.'
                    : workspace.role === 'admin'
                      ? 'You manage this workspace.'
                      : 'You are a member of this workspace.'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ux-empty">
          {kind === 'programmes'
            ? 'Programme management is available to workspace owners and admins.'
            : 'No workspaces yet. Start a request or create your workspace to continue.'}
        </p>
      )}
      <p>
        <Link className="text-link" prefetch={false} href="/account?view=work#customer-workspaces">
          Manage your workspaces
        </Link>
      </p>
      {kind === 'programmes' && (
        <p>
          <Link className="text-link" prefetch={false} href="/account/delegations">
            Your programme registrations
          </Link>
        </p>
      )}
    </section>
  );
}
