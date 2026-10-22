'use client';

import { OperatorIcon } from '../../components/operator-icon';

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
  workspaceName,
  members,
  membersLoaded,
  busy,
  enabled,
  onLoadMembers,
  onUpdateMember,
  onChangeFeature,
}: {
  workspaceName: string;
  members: Member[];
  membersLoaded: boolean;
  busy: boolean;
  enabled: (key: string) => boolean;
  onLoadMembers: () => void;
  onUpdateMember: (value: { userId: string; role: string; revoked: boolean }) => void;
  onChangeFeature: (key: string, value: boolean) => void;
}) {
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
                  {member.name ?? member.user_id} · {member.role} ·{' '}
                  {member.revoked_at ? 'Revoked' : 'Active'}
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
            Only the workspace owner can change these roles. Clearing “Revoke membership” restores
            that existing membership; it does not reactivate a suspended identity. New staff
            invitations and lost authenticators require reviewed recovery.
          </p>
        </details>
      </section>
      <section className="ux-controls-features" aria-labelledby="workspace-tools-heading">
        <div className="ux-controls-section-heading">
          <div>
            <h3 id="workspace-tools-heading">Available tools</h3>
            <p>Each change saves a new version. Disabling a tool preserves its records.</p>
          </div>
        </div>
        <div className="ux-controls-notice">
          <p>
            A workspace setting does not activate a disabled deployment. Provider approval, source
            rights and independent review remain separate. Test settings cannot authorize real
            customer work, outreach or payouts.
          </p>
        </div>
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
      </section>
    </div>
  );
}
