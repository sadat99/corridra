'use client';

import { useState } from 'react';
import { formatDateTime } from '../../lib/ux/format';
import { useOperatorFlags } from './operator-flags';
import { PanelHeading } from './panel-heading';
import './desk-helpers-status-team.css';

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
// Event kinds are "<record>.<insert|update|delete>" from the change triggers, or one exact name.
// Every kind listed here was read from the migrations; anything else keeps the plain fallback.
const eventRecords = new Map([
  ['config_version', 'Workspace setting'],
  ['membership', 'Membership'],
  ['mission', 'Mission'],
  ['source', 'Source'],
  ['source_record', 'Source'],
  ['claim', 'Claim'],
  ['evidence', 'Evidence'],
  ['evidence_object', 'Evidence'],
  ['evidence_state', 'Evidence status'],
  ['scan_report', 'File scan report'],
  ['fact', 'Fact'],
  ['canonical_fact', 'Fact'],
  ['verification', 'Verification'],
  ['relationship', 'Company relationship'],
  ['opportunity', 'Opportunity'],
  ['intake_destination', 'Request destination'],
  ['organisation', 'Company'],
  ['organisation_source', 'Company source'],
  ['organisation_attribute', 'Company detail'],
  ['private_contact_data', 'Private contact'],
  ['private_note', 'Private note'],
  ['private_contact_change', 'Private contact change'],
  ['private_note_change', 'Private note change'],
  ['private_record_redaction', 'Private record removal'],
  ['entity_candidate', 'Possible duplicate'],
  ['entity_resolution', 'Duplicate decision'],
  ['target_account', 'Target company'],
  ['target_contact', 'Target contact'],
  ['match_assessment', 'Review for fit'],
  ['assessment_claim', 'Review for fit claim'],
  ['research_command', 'Research action'],
  ['communication_policy', 'Message policy'],
  ['communication_template', 'Message template'],
  ['communication', 'Message'],
  ['communication_command', 'Message action'],
  ['communication_dispatch', 'Message send'],
  ['communication_receipt', 'Message receipt'],
  ['communication_attempt', 'Message attempt'],
  ['communication_optout', 'Message opt-out'],
  ['buyer_link', 'Buyer link'],
  ['buyer_link_revocation', 'Buyer link withdrawal'],
  ['buyer_response', 'Buyer reply'],
  ['meeting', 'Meeting'],
  ['meeting_participant', 'Meeting participant'],
  ['meeting_brief', 'Meeting brief'],
  ['meeting_outcome', 'Meeting outcome'],
  ['meeting_command', 'Meeting action'],
  ['follow_up', 'Follow-up'],
]);
const eventActions = new Map([
  ['insert', 'added'],
  ['update', 'updated'],
  ['delete', 'removed'],
]);
// A staff member opened a read-only preview of another role's view (the role is in the event record).
const eventNames = new Map([['view_as.open', 'Preview opened']]);
export function eventLabel(type: string | undefined) {
  const named = eventNames.get(type ?? '');
  if (named) return named;
  const parts = (type ?? '').split('.');
  const record = eventRecords.get(parts[0] ?? '');
  const action = eventActions.get(parts[1] ?? '');
  return parts.length === 2 && record && action
    ? `${record} ${action}`
    : 'Workspace change recorded';
}
export function auditTime(value: string | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Time unavailable';
  return formatDateTime(value);
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
  const { teamDeskV41: deskV41 } = useOperatorFlags();
  const [requestedPage, setRequestedPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(events.length / 10));
  const page = Math.min(requestedPage, pageCount - 1);
  const visibleEvents = events.slice(page * 10, (page + 1) * 10);
  return (
    <div className="ux-audit-workspace">
      {deskV41 ? (
        // Team desk v4.1 (D16): the page title and its purpose line say this once; the heading stays for
        // screen readers so the page keeps its outline.
        <h2 className="sr-only">Access and audit</h2>
      ) : (
        <PanelHeading
          title="Access and audit"
          eyebrow="Settings and access"
          icon="shield"
          description="See who has access and what changed in this workspace."
        />
      )}
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
            ? 'Loading Access…'
            : loaded
              ? 'Refresh Access and Recent Changes'
              : 'Load Access and Recent Changes'}
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
                    <time dateTime={event.occurred_at}>{auditTime(event.occurred_at)}</time>
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
                    Previous Changes
                  </button>
                  <button
                    type="button"
                    className="text-link"
                    disabled={busy || page === pageCount - 1}
                    onClick={() => setRequestedPage(page + 1)}
                  >
                    Next Changes
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
