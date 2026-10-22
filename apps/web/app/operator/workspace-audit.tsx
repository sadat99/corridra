'use client';

import { useState } from 'react';
import { PanelHeading } from './panel-heading';

type Member = { user_id?: string; name?: string | null; role?: string; revoked_at?: string | null };
type AuditEvent = {
  id: string;
  type?: string;
  occurred_at?: string;
  aggregate_type?: string;
  aggregate_id?: string;
  actor_id?: string;
  correlation_id?: string;
};
function eventLabel(type: string | undefined) {
  const labels: Record<string, string> = {
    config_version: 'Workspace setting',
    membership: 'Membership',
    mission: 'Mission',
    source: 'Source',
    claim: 'Claim',
    evidence: 'Evidence',
    fact: 'Fact',
    organisation: 'Company',
  };
  const actions: Record<string, string> = { insert: 'added', update: 'updated', delete: 'removed' };
  const [record, action] = (type ?? '').split('.');
  return labels[record] && actions[action]
    ? `${labels[record]} ${actions[action]}`
    : 'Workspace change recorded';
}
function time(value: string | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Time unavailable';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}
export function WorkspaceAudit({
  members,
  events,
  loaded,
  busy,
  onLoad,
}: {
  members: Member[];
  events: AuditEvent[];
  loaded: boolean;
  busy: boolean;
  onLoad: () => void;
}) {
  const [requestedPage, setRequestedPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(events.length / 10));
  const page = Math.min(requestedPage, pageCount - 1);
  const visibleEvents = events.slice(page * 10, (page + 1) * 10);
  return (
    <div className="ux-audit-workspace">
      <PanelHeading
        title="Access and audit"
        eyebrow="Settings and access"
        icon="shield"
        description="See who has access and what changed in this workspace."
      />
      <div className="ux-audit-toolbar">
        <p>
          Read-only review. Viewing a record does not change access, verify a source or authorize a
          payment.
        </p>
        <button
          type="button"
          className="primary-link"
          disabled={busy}
          onClick={() => {
            setRequestedPage(0);
            onLoad();
          }}
        >
          {busy
            ? 'Loading access…'
            : loaded
              ? 'Refresh access and recent changes'
              : 'Load access and recent changes'}
        </button>
      </div>
      {!loaded && (
        <div className="ux-panel-empty">
          <h3>Review access when you need it</h3>
          <p>
            Load the current members and up to 50 latest workspace events. No permissions will be
            changed.
          </p>
        </div>
      )}
      {loaded && (
        <>
          <div className="ux-audit-counts">
            <div>
              <span>Members returned</span>
              <strong>{members.length}</strong>
            </div>
            <div>
              <span>Recent events returned</span>
              <strong>{events.length}</strong>
            </div>
          </div>
          <section aria-labelledby="audit-members-heading">
            <h3 id="audit-members-heading">Workspace members</h3>
            <ul className="ux-audit-members" role="list">
              {members.map((member) => (
                <li key={member.user_id}>
                  <div>
                    <strong>{member.name ?? 'Unnamed member'}</strong>
                    <span className="ux-audit-role">{member.role ?? 'Role unavailable'}</span>
                  </div>
                  <span
                    className={member.revoked_at ? 'ux-record-state' : 'ux-record-state is-active'}
                  >
                    {member.revoked_at ? 'Access revoked' : 'Active membership'}
                  </span>
                  <details>
                    <summary>Member reference</summary>
                    <code>{member.user_id}</code>
                  </details>
                </li>
              ))}
            </ul>
            {!members.length && (
              <p className="ux-panel-empty">No members were returned for this workspace.</p>
            )}
          </section>
          <section aria-labelledby="audit-events-heading">
            <h3 id="audit-events-heading">Recent changes</h3>
            <p>Latest first. Open a record to inspect its exact event type and references.</p>
            <ol className="ux-audit-events" role="list" start={page * 10 + 1}>
              {visibleEvents.map((event) => (
                <li key={event.id} data-event={event.id}>
                  <div className="ux-audit-event-heading">
                    <strong>{eventLabel(event.type)}</strong>
                    <time dateTime={event.occurred_at}>{time(event.occurred_at)}</time>
                  </div>
                  <details>
                    <summary>Event references</summary>
                    <dl>
                      {[
                        ['Event type', event.type],
                        ['Event reference', event.id],
                        ['Record type', event.aggregate_type],
                        ['Record reference', event.aggregate_id],
                        ['Actor reference', event.actor_id],
                        ['Request reference', event.correlation_id],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <dt>{label}</dt>
                          <dd>
                            <code>{value ?? 'Not recorded'}</code>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                </li>
              ))}
            </ol>
            {events.length > 0 && (
              <nav className="ux-audit-pagination" aria-label="Recent changes pages">
                <p>
                  {page * 10 + 1}–{Math.min((page + 1) * 10, events.length)} of {events.length}{' '}
                  returned events
                </p>
                <div>
                  <button
                    type="button"
                    className="text-link"
                    disabled={busy || page === 0}
                    onClick={() => setRequestedPage(page - 1)}
                  >
                    Previous changes
                  </button>
                  <button
                    type="button"
                    className="text-link"
                    disabled={busy || page === pageCount - 1}
                    onClick={() => setRequestedPage(page + 1)}
                  >
                    Next changes
                  </button>
                </div>
              </nav>
            )}
            {!events.length && (
              <p className="ux-panel-empty">No recent changes were returned for this workspace.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
