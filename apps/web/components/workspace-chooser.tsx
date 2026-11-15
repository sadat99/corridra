import './ux/row-list.css';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { DomainError } from '@corridra/domain';
import { accountAccessPath, organiserPath } from '../lib/account-return';
import { foundations } from '../lib/foundations';
import {
  activeWorkspaces,
  workspaceDescription,
  workspacePath,
  workspacesFor,
  type WorkspaceKind,
} from '../lib/workspace-choice';

/** A choice of workspace grants nothing; destination APIs repeat the fresh identity and role checks. */
export async function WorkspaceChooser({
  kind,
  enabled,
  linksEnabled = false,
}: {
  kind: WorkspaceKind;
  enabled: boolean;
  /** Whether company links are on; the profile description mentions them only then. */
  linksEnabled?: boolean;
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
    // Only the organiser chooser carries the person back after sign-in or verification; the other kinds
    // keep their plain redirects.
    const back = kind === 'programmes';
    if (error instanceof DomainError && error.status === 401)
      redirect(back ? accountAccessPath('/signin', organiserPath) : '/signin');
    if (
      error instanceof DomainError &&
      error.status === 403 &&
      error.message === 'Verify your email to continue'
    )
      redirect(back ? accountAccessPath('/verify-email', organiserPath) : '/verify-email');
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
  // Billing and the profile keep archived workspaces (money and history), after the active ones. The other
  // destinations start new work, so they offer only active workspaces.
  const offered = workspacesFor(kind, workspaces);
  const active = activeWorkspaces(offered);
  const visible = [...active, ...offered.filter((workspace) => !active.includes(workspace))];
  const eligible = workspacesFor(kind, workspaces, true);
  // Every workspace that could be chosen is archived: say so, never "membership alone".
  const archivedOnly = visible.length === 0 && eligible.length > 0;
  // Organising needs a workspace the person owns or manages; membership alone does not give one.
  const memberOnly = kind === 'programmes' && eligible.length === 0 && workspaces.length > 0;
  // One workspace leaves nothing to choose: go straight to it.
  if (visible.length === 1) redirect(workspacePath(kind, visible[0]!.id));
  return (
    <section aria-labelledby="workspace-choice-title">
      <h2 id="workspace-choice-title">
        {visible.length
          ? 'Choose a workspace'
          : archivedOnly
            ? 'No active workspace'
            : 'Create a workspace'}
      </h2>
      <p>{workspaceDescription(kind, linksEnabled)}</p>
      {visible.length ? (
        <ul className="ux-quick-links">
          {visible.map((workspace) => (
            <li key={workspace.id}>
              <Link prefetch={false} href={workspacePath(kind, workspace.id)}>
                <strong>{workspace.name}</strong>
                {workspace.archived ? <span className="ux-badge">Archived</span> : null}
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
        <>
          <p className="ux-empty">
            {archivedOnly
              ? kind === 'programmes'
                ? 'Your workspaces that can organise programmes are archived. The owner can restore one from your workspaces, or you can create a new one.'
                : 'Your workspaces are archived. The owner can restore one from your workspaces, or you can create a new one.'
              : kind !== 'programmes'
                ? 'You do not have a workspace yet. Create one to continue.'
                : memberOnly
                  ? 'Only workspace owners and admins can organise programmes. Create a workspace of your own to organise.'
                  : 'Organising a programme needs a workspace. Create one to continue.'}
          </p>
          <p>
            <Link
              className="primary-link"
              prefetch={false}
              href="/account?view=work#customer-workspaces"
            >
              Create a Workspace
            </Link>
          </p>
        </>
      )}
      {(visible.length > 0 || archivedOnly) && (
        <p>
          <Link
            className="text-link"
            prefetch={false}
            href="/account?view=work#customer-workspaces"
          >
            Manage your workspaces
          </Link>
        </p>
      )}
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
