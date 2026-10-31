'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { PhoneFold } from '../../components/phone-fold';
import { OperatorIcon } from '../../components/operator-icon';
import { ActionFeedback, useActionFeedback } from '../../components/ux/feedback';
import { formatDateTime } from '../../lib/ux/format';
import { readJson, withStepUp } from '../../lib/ux/step-up';

const roleNames: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  operator: 'Operator',
  reviewer: 'Reviewer',
  viewer: 'Viewer',
};

/**
 * The workspace this page shows. The workspace passes it once the lead wires the prop; until then it
 * is read the same way the page chose it: the `workspace` address parameter, else the first
 * workspace the person belongs to.
 */
export function useCurrentTenant(tenant?: string) {
  const [found, setFound] = useState('');
  useEffect(() => {
    if (tenant) return;
    const fromAddress = new URLSearchParams(window.location.search).get('workspace');
    let live = true;
    (fromAddress
      ? Promise.resolve([{ id: fromAddress }])
      : fetch('/api/workspace/tenants', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : []))
    )
      .then((list: { id: string }[]) => {
        if (live && list[0]) setFound(list[0].id);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [tenant]);
  return tenant ?? found;
}

async function teamControl(tenant: string, action: string, body?: unknown) {
  return readJson<Record<string, unknown>>(
    await fetch(`/api/team-control/${action}?${new URLSearchParams({ tenant })}`, {
      method: body === undefined ? 'GET' : 'POST',
      cache: 'no-store',
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    }),
  );
}

type Invitation = {
  id: string;
  name: string;
  email: string;
  role: string;
  expiresAt: string;
  state: 'PENDING' | 'EXPIRED';
};

/** Team invitations (CQ-74, D8). Shown only when CORRIDRA_TEAM_INVITES is on for this deployment. */
function TeamInvites({ tenant, workspaceName }: { tenant: string; workspaceName: string }) {
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const feedback = useActionFeedback();
  const listFeedback = useActionFeedback();
  const showListError = listFeedback.error;
  const load = useCallback(async () => {
    try {
      const body = await teamControl(tenant, 'invites');
      setInvitations(body.invitations as Invitation[]);
      setAvailable(true);
    } catch (error) {
      if ((error as { status?: number }).status === 404) setAvailable(false);
      else {
        setAvailable(true);
        setInvitations([]);
        showListError(error instanceof Error ? error.message : 'Invitations could not load.');
      }
    }
  }, [tenant, showListError]);
  useEffect(() => {
    if (!tenant) return;
    let live = true;
    teamControl(tenant, 'invites')
      .then((body) => {
        if (!live) return;
        setInvitations(body.invitations as Invitation[]);
        setAvailable(true);
      })
      .catch((error: unknown) => {
        if (!live) return;
        setAvailable((error as { status?: number }).status === 404 ? false : true);
        setInvitations([]);
      });
    return () => {
      live = false;
    };
  }, [tenant]);
  if (!tenant || available === false) return null;
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const f = new FormData(form);
    const invite = {
      commandId: crypto.randomUUID(),
      name: String(f.get('name') ?? ''),
      email: String(f.get('email') ?? ''),
      role: String(f.get('role') ?? ''),
    };
    setBusy(true);
    feedback.clear();
    try {
      const result = await withStepUp(() =>
        teamControl(tenant, 'invites', { action: 'invite', invite }),
      );
      const email = (result.notification as { email?: string } | undefined)?.email;
      feedback.success(
        email === 'sent'
          ? `Invitation sent to ${invite.email}. It works for 7 days.`
          : `Invitation sent to their Corridra inbox. Email is not sent from this deployment yet, so tell ${invite.email} to open ${window.location.origin}/operator/setup within 7 days.`,
      );
      form.reset();
      await load();
    } catch (error) {
      feedback.error(error instanceof Error ? error.message : 'The invitation was not sent.');
    } finally {
      setBusy(false);
    }
  }
  async function change(action: 'resend' | 'cancel', item: Invitation) {
    if (action === 'cancel' && !window.confirm(`Cancel the invitation for ${item.email}?`)) return;
    setBusy(true);
    listFeedback.clear();
    try {
      await withStepUp(() => teamControl(tenant, 'invites', { action, invitationId: item.id }));
      listFeedback.success(
        action === 'resend'
          ? `Invitation for ${item.email} sent again. It works for 7 more days.`
          : `Invitation for ${item.email} cancelled.`,
      );
      await load();
    } catch (error) {
      listFeedback.error(error instanceof Error ? error.message : 'The change was not saved.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="ux-controls-invites" aria-labelledby="team-invites-heading">
      <div className="ux-controls-section-heading">
        <div>
          <h3 id="team-invites-heading">Invite a team member</h3>
          <p>
            Add someone to <strong>{workspaceName}</strong>. They set a password and an
            authenticator when they accept. The invitation works for 7 days.
          </p>
        </div>
      </div>
      <form className="operator-form" onSubmit={(event) => void send(event)}>
        <fieldset disabled={busy}>
          <legend>New team invitation</legend>
          <label className="field">
            Name
            <input name="name" required maxLength={80} autoComplete="off" />
          </label>
          <label className="field">
            Email
            <input name="email" type="email" required maxLength={254} autoComplete="off" />
          </label>
          <label className="field">
            Role for the new member
            <select name="role" required defaultValue="">
              <option value="" disabled>
                Choose a role
              </option>
              {Object.entries(roleNames).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button className="primary-link">{busy ? 'Sending…' : 'Send invitation'}</button>
          <ActionFeedback
            scope="team-invite"
            feedback={feedback.feedback}
            onClear={feedback.clear}
          />
        </fieldset>
      </form>
      <h4>Pending invitations</h4>
      <ActionFeedback
        scope="team-invite-list"
        feedback={listFeedback.feedback}
        onClear={listFeedback.clear}
      />
      {invitations === null ? (
        <p>Loading invitations.</p>
      ) : invitations.length === 0 ? (
        <p>No pending invitations.</p>
      ) : (
        <ul className="ux-controls-invite-list">
          {invitations.map((item) => (
            <li key={item.id}>
              <strong>{item.name}</strong> · {item.email} · {roleNames[item.role] ?? item.role}
              <span>
                {item.state === 'PENDING'
                  ? ` · Works until ${formatDateTime(item.expiresAt)}`
                  : ' · Expired'}
              </span>
              <span className="ux-controls-invite-actions">
                <button
                  type="button"
                  className="text-link"
                  disabled={busy}
                  onClick={() => void change('resend', item)}
                >
                  Resend
                </button>
                <button
                  type="button"
                  className="text-link"
                  disabled={busy}
                  onClick={() => void change('cancel', item)}
                >
                  Cancel invitation
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Lost authenticator (V-03): the owner resets another member's authenticator. */
function AuthenticatorReset({ tenant, members }: { tenant: string; members: Member[] }) {
  const [busy, setBusy] = useState(false);
  const feedback = useActionFeedback();
  const active = members.filter((m) => m.user_id && !m.revoked_at);
  async function reset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const userId = String(new FormData(form).get('member') ?? '');
    const member = active.find((m) => m.user_id === userId);
    if (!member) return;
    if (
      !window.confirm(
        `Reset the authenticator for ${member.name ?? 'this member'}? They are signed out and set up a new authenticator at their next sign-in.`,
      )
    )
      return;
    setBusy(true);
    feedback.clear();
    try {
      await withStepUp(() => teamControl(tenant, 'authenticator-reset', { userId }));
      feedback.success(
        `Authenticator reset for ${member.name ?? 'the member'}. They set up a new one at their next sign-in.`,
      );
      form.reset();
    } catch (error) {
      feedback.error(error instanceof Error ? error.message : 'The reset was not saved.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="operator-form ux-controls-reset" onSubmit={(event) => void reset(event)}>
      <fieldset disabled={busy || !tenant || !active.length}>
        <legend>Reset a lost authenticator</legend>
        <p>
          For a member who lost their phone or authenticator app. You confirm your own authenticator
          first. The change is recorded in the security history.
        </p>
        <label className="field">
          Member to reset
          <select name="member" required defaultValue="">
            <option value="" disabled>
              {active.length ? 'Choose a member' : 'Load workspace members first'}
            </option>
            {active.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.name ?? 'Unnamed member'} · {roleNames[m.role ?? ''] ?? m.role}
              </option>
            ))}
          </select>
        </label>
        <button className="primary-link">{busy ? 'Please wait…' : 'Reset authenticator'}</button>
        <ActionFeedback
          scope="authenticator-reset"
          feedback={feedback.feedback}
          onClear={feedback.clear}
        />
      </fieldset>
    </form>
  );
}

type Member = {
  user_id?: string;
  name?: string | null;
  role?: string;
  revoked_at?: string | null;
};
const groups = [
  {
    title: 'Evidence and files',
    icon: 'document',
    items: [
      ['evidence.uploads', 'Evidence uploads', 'Allow files to be added as evidence.'],
      [
        'evidence.verification',
        'Evidence verification',
        'Allow evidence to be submitted for validation.',
      ],
      [
        'evidence.scan_bypass',
        'Deferred file scanning',
        'Allow unscanned files to be marked as bypassed. This does not make a file safe.',
      ],
    ],
  },
  {
    title: 'Company research',
    icon: 'search',
    items: [
      [
        'research.ingestion',
        'Research intake',
        'Allow research sources and claims to be recorded.',
      ],
      [
        'research.resolution',
        'Research review',
        'Allow research claims to be reviewed and resolved.',
      ],
    ],
  },
  {
    title: 'Introductions and messages',
    icon: 'people',
    items: [
      [
        'communications.introductions',
        'Introductions',
        'Allow introductions within the approved scope.',
      ],
      [
        'communications.dispatch',
        'Message dispatch',
        'Allow approved messages to be sent through configured channels.',
      ],
    ],
  },
  {
    title: 'Commercial progress',
    icon: 'progress',
    items: [
      [
        'opportunities.commands',
        'Commercial updates',
        'Allow commercial progress and outcomes to be recorded.',
      ],
    ],
  },
  {
    title: 'Assistance and network',
    icon: 'network',
    items: [
      [
        'ai.enabled',
        'AI assistance',
        'Allow assistance where deployment approval and source rights permit it.',
      ],
      [
        'network.enabled',
        'Execution network',
        'Allow reviewed contributor work. Invitations, assignments and rewards keep their separate checks.',
      ],
    ],
  },
] as const;

export function WorkspaceControls({
  tenant: tenantProp,
  workspaceName,
  members,
  membersLoaded,
  busy,
  enabled,
  onLoadMembers,
  onUpdateMember,
  onChangeFeature,
}: {
  /** Optional until the workspace passes it (integration note); see useCurrentTenant. */
  tenant?: string;
  workspaceName: string;
  members: Member[];
  membersLoaded: boolean;
  busy: boolean;
  enabled: (key: string) => boolean;
  onLoadMembers: () => void;
  onUpdateMember: (value: { userId: string; role: string; revoked: boolean }) => void;
  onChangeFeature: (key: string, value: boolean) => void;
}) {
  const tenant = useCurrentTenant(tenantProp);
  return (
    <div className="ux-workspace-controls">
      <header className="ux-controls-heading">
        <div>
          <p className="eyebrow">Workspace settings</p>
          <h2>Workspace controls</h2>
          <p>
            Manage member access and available tools for <strong>{workspaceName}</strong>.
          </p>
        </div>
        <span className="ux-controls-owner">
          <OperatorIcon name="shield" /> Owner access
        </span>
      </header>
      <div className="ux-controls-boundary">
        <OperatorIcon name="lock" />
        <p>
          Changes apply only to this workspace. Sensitive changes require a current authenticator
          check. <a href="#workspace-authenticator">Verify your authenticator</a>
        </p>
      </div>
      <section className="ux-controls-members" aria-labelledby="workspace-members-heading">
        <div className="ux-controls-section-heading">
          <div>
            <h3 id="workspace-members-heading">People and access</h3>
            <p>Change the role or access of an existing member.</p>
          </div>
          <button type="button" className="text-link" disabled={busy} onClick={onLoadMembers}>
            {busy
              ? 'Please wait…'
              : membersLoaded
                ? 'Refresh workspace members'
                : 'Load workspace members'}
          </button>
        </div>
        <p className="ux-controls-hint" role="status">
          {membersLoaded
            ? members.length
              ? `${members.length} workspace ${members.length === 1 ? 'member' : 'members'} loaded. Choose a member and the intended role.`
              : 'No existing members were returned for this workspace.'
            : 'Load workspace members to choose whose access to update.'}
        </p>
        <form
          className="operator-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            onUpdateMember({
              userId: String(form.get('user') ?? ''),
              role: String(form.get('role') ?? ''),
              revoked: form.get('revoked') === 'on',
            });
          }}
        >
          <label className="field">
            Workspace member
            <select name="user" required disabled={!members.length || busy} defaultValue="">
              <option value="" disabled>
                Select an existing member
              </option>
              {members.map((member) => (
                <option key={member.user_id} value={member.user_id}>
                  {member.name ?? 'Unnamed member'} · {roleNames[member.role ?? ''] ?? member.role}{' '}
                  · {member.revoked_at ? 'Revoked' : 'Active'}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Role
            <select name="role" required disabled={!members.length || busy} defaultValue="">
              <option value="" disabled>
                Select the intended role
              </option>
              {['owner', 'admin', 'operator', 'reviewer', 'viewer'].map((role) => (
                <option key={role} value={role}>
                  {role[0].toUpperCase() + role.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label className="ux-controls-revoke">
            <input type="checkbox" name="revoked" disabled={!members.length || busy} />
            <span>
              Revoke membership<small>Remove this member’s access to this workspace.</small>
            </span>
          </label>
          <button className="primary-link" disabled={busy || !members.length}>
            {busy ? 'Please wait…' : 'Update membership'}
          </button>
        </form>
        <details className="ux-controls-help">
          <summary>Membership rules and recovery</summary>
          <p>
            Only the workspace owner can change these roles, send team invitations and reset an
            authenticator. Clearing “Revoke membership” restores that existing membership; it does
            not reactivate a suspended identity.
          </p>
        </details>
        <AuthenticatorReset tenant={tenant} members={members} />
      </section>
      <TeamInvites tenant={tenant} workspaceName={workspaceName} />
      <section className="ux-controls-features" aria-labelledby="workspace-tools-heading">
        <div className="ux-controls-section-heading">
          <div>
            <h3 id="workspace-tools-heading">Available tools</h3>
            <p>Each change saves a new version. Disabling a tool preserves its records.</p>
          </div>
        </div>
        <div className="ux-controls-notice">
          <p>
            A workspace setting does not switch on a feature that is off for the whole deployment.
            Provider approval, source rights and independent review stay separate. No setting here
            starts automated outreach or payouts.
          </p>
        </div>
        <PhoneFold
          summary={`Show all ${groups.reduce((n, g) => n + g.items.length, 0)} tools (${groups.reduce(
            (n, g) => n + g.items.filter((item) => enabled(item[0])).length,
            0,
          )} on)`}
        >
          <div className="ux-controls-groups">
            {groups.map((group) => (
              <section className="ux-controls-group" key={group.title} aria-label={group.title}>
                <h4>
                  <OperatorIcon name={group.icon} />
                  {group.title}
                </h4>
                {group.items.map(([key, title, description]) => {
                  const active = enabled(key);
                  return (
                    <article
                      key={key}
                      className="ux-controls-feature"
                      data-feature={key}
                      aria-label={title}
                    >
                      <div className="ux-controls-feature-copy">
                        <h5>{title}</h5>
                        <p>{description}</p>
                      </div>
                      <div className="ux-controls-feature-action">
                        <span
                          className={active ? 'ux-controls-state is-enabled' : 'ux-controls-state'}
                        >
                          {active ? 'Enabled' : 'Disabled'}
                        </span>
                        <button
                          type="button"
                          className="text-link"
                          aria-label={`${active ? 'Disable' : 'Enable'} ${title.toLowerCase()}`}
                          disabled={busy}
                          onClick={() => onChangeFeature(key, !active)}
                        >
                          {active ? 'Disable' : 'Enable'}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </section>
            ))}
          </div>
        </PhoneFold>
      </section>
    </div>
  );
}
