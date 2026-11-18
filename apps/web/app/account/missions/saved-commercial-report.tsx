'use client';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { DeliveryReport } from '@corridra/delivery/report';
import { MissionPassport } from '../../../components/mission-passport';
import { PrivacyLabel, PrivacyLabelScope } from '../../../components/privacy-label';
import { MissionExperienceView } from '../../mission-experience-view';
import { displayMoney } from '@corridra/domain/locale';
import { formatMoment, formatUtcDay } from '../../../lib/ux/format';
import {
  evidenceRequestStatusWords,
  meetingStatusWords,
} from '../../../lib/ux/mission-status-words';
import { SubTabs } from '../../../components/ux/sub-tabs';
import { translate } from '../../../lib/i18n/messages';
import { savedMissionHeaders, savedMissionRead, type SavedMissionScope } from '../saved-missions';
import { DecisionHistory } from './decision-history';
import { SpecificationConfirmation } from './specification-confirmation';
import { BookDownloads, createPendingBooks, type BookTarget } from './book-downloads';
import { limitWords } from '../../../lib/account-limit';
import { report } from '../../../lib/saved-report-check';
import './report-page.css';
import './report-budget.css';
/** `none` reads and keeps the report without drawing it: the Room's Overview uses it for its summary. */
export type ReportSection = 'all' | 'compare' | 'evidence' | 'trip' | 'none';
type Scope = SavedMissionScope & {
  resourceId: string;
  decisionsEnabled?: boolean;
  specificationConfirmationsEnabled?: boolean;
  /** Trip Book and Supplier Book downloads (`CORRIDRA_UX_BOOKS`, read on the server). Only the whole page shows them. */
  books?: boolean;
  /** Decision cards (`CORRIDRA_SHARE_CARD`, read on the server): the owner panel inside the decisions. */
  decisionCards?: boolean;
  /** UX update (`CORRIDRA_UX_LENSES`, read on the server): the offers as cards. */
  lenses?: boolean;
  /** The Room shows the report in two lenses. `all` is the whole page, as it has always been. */
  section?: ReportSection;
  /** The Room's Trip lens draws the reviewed itinerary itself, so this file imports no Room code. */
  renderTrip?: (itinerary: DeliveryReport['missions'][number]['itinerary']) => ReactNode;
  /**
   * The Room's summary (approved work rooms, 5 Nov 2026) is drawn from this same read, so the Room asks for the
   * report once. It is told the report and the read state whenever either changes.
   */
  onReport?: (report: DeliveryReport | null, status: string) => void;
  /** Member access (`CORRIDRA_MEMBER_ACCESS`, read on the server) is on: the labels name the workspace's owners and admins. */
  memberAccess?: boolean;
  /**
   * ADR-087 U5: a workspace owner or admin reads a member's saved report, read only, through the member access route.
   * There is no response form, no decision or confirmation panel and no label: only the report and its books.
   */
  member?: { workspaceId: string };
};
type MemberSource = { label: string | null; workspaceName: string | null };
const memberEndpoint = '/api/customer-member-access';
export function SavedCommercialReport(props: Scope) {
  return (
    <PrivacyLabelScope
      value={{ memberAccess: props.memberAccess === true, omitted: !!props.member }}
    >
      <PrivateReport
        key={JSON.stringify([props.issuer, props.subject, props.resourceId])}
        {...props}
      />
    </PrivacyLabelScope>
  );
}
function PrivateReport({
  subject,
  issuer,
  resourceId,
  decisionsEnabled = false,
  specificationConfirmationsEnabled = false,
  books = false,
  decisionCards = false,
  lenses = false,
  section = 'all',
  renderTrip,
  onReport,
  memberAccess = false,
  member,
}: Scope) {
  const responsePrefix = useId();
  const [data, setData] = useState<DeliveryReport | null>(null),
    [status, setStatus] = useState('loading');
  const [drafts, setDrafts] = useState<Record<string, { body: string; acknowledged: boolean }>>({});
  const [pending, setPending] = useState<{
    requestId: string;
    body: string;
    acknowledged: true;
    commandId: string;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  // A book download that could not be confirmed keeps its command id here, so it survives the panel being removed
  // when the page is hidden. A denial of a book download is said in its own alert, which takes the focus.
  const [pendingBooks] = useState(createPendingBooks);
  const [bookDenial, setBookDenial] = useState<{ message: string; signedOut: boolean } | null>(
    null,
  );
  const bookAlert = useRef<HTMLParagraphElement>(null);
  // Who saved the report and in which workspace, for the member read only.
  const [source, setSource] = useState<MemberSource | null>(null);
  const memberWorkspace = member?.workspaceId;
  const read = useCallback(() => {
    controller.current?.abort();
    const task = new AbortController();
    controller.current = task;
    void fetch(memberWorkspace ? memberEndpoint : '/api/customer-saved-missions', {
      method: 'POST',
      cache: 'no-store',
      signal: task.signal,
      headers: savedMissionHeaders({ subject, issuer }),
      body: JSON.stringify(
        memberWorkspace
          ? { action: 'report', workspaceId: memberWorkspace, resourceId }
          : { action: 'view', resourceId, audience: 'CLIENT_PROGRESS' },
      ),
    })
      .then(savedMissionRead)
      .then((value) => {
        const next = report(value, resourceId);
        const from = value as { memberLabel?: unknown; workspaceName?: unknown };
        if (!task.signal.aborted) {
          setData(next);
          if (memberWorkspace)
            setSource({
              label: typeof from.memberLabel === 'string' ? from.memberLabel : null,
              workspaceName: typeof from.workspaceName === 'string' ? from.workspaceName : null,
            });
          setStatus('ready');
          setBookDenial(null);
        }
      })
      .catch((error) => {
        if (!task.signal.aborted) {
          setData(null);
          if (error instanceof Error && error.message === 'denied') {
            setPending(null);
            setDrafts({});
            pendingBooks.clear();
            setBookDenial(null);
            if (!memberWorkspace)
              setNotice(
                'Access or request state changed. Local response recovery was cleared for privacy.',
              );
          }
          setStatus(
            error instanceof Error && ['denied', 'unavailable', 'limit'].includes(error.message)
              ? error.message
              : 'failed',
          );
        }
      });
  }, [subject, issuer, resourceId, pendingBooks, memberWorkspace]);
  useEffect(() => {
    function clear() {
      controller.current?.abort();
      setData(null);
      setStatus('loading');
      setBusy(false);
    }
    function visible() {
      if (document.hidden) clear();
      else read();
    }
    // A member read writes an audit event, so it happens once, when the page is opened: switching tabs neither clears nor
    // reads it again, and a page restored from the back-forward cache stays closed until it is reloaded.
    function show(event: PageTransitionEvent) {
      if (event.persisted) {
        clear();
        if (memberWorkspace) setStatus('closed');
        else read();
      }
    }
    read();
    window.addEventListener('pagehide', clear);
    window.addEventListener('pageshow', show);
    if (!memberWorkspace) document.addEventListener('visibilitychange', visible);
    return () => {
      controller.current?.abort();
      window.removeEventListener('pagehide', clear);
      window.removeEventListener('pageshow', show);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [read, memberWorkspace]);
  useEffect(() => {
    if (bookDenial) bookAlert.current?.focus();
  }, [bookDenial]);
  useEffect(() => {
    onReport?.(data, status);
  }, [onReport, data, status]);
  // A book download was refused because access is gone: the report and every local retry are cleared, as for any
  // other denial, and the reason is said once, in the alert that takes the focus.
  function bookDenied(message: string, signedOut: boolean) {
    controller.current?.abort();
    setData(null);
    setPending(null);
    setDrafts({});
    pendingBooks.clear();
    setStatus('denied');
    setBookDenial({ message, signedOut });
  }
  async function respond(requestId: string) {
    if (inFlight.current || (pending && pending.requestId !== requestId)) return;
    const draft = drafts[requestId];
    const command =
      pending ??
      (draft?.acknowledged && draft.body.trim().length >= 3
        ? {
            requestId,
            body: draft.body,
            acknowledged: true as const,
            commandId: crypto.randomUUID(),
          }
        : null);
    if (!command) {
      setNotice('Enter a response and acknowledge that it is your unverified declaration.');
      return;
    }
    setPending(command);
    setBusy(true);
    setNotice('');
    inFlight.current = true;
    controller.current?.abort();
    const task = new AbortController();
    controller.current = task;
    try {
      const value = await savedMissionRead(
        await fetch('/api/customer-saved-missions', {
          method: 'POST',
          signal: task.signal,
          headers: savedMissionHeaders({ subject, issuer }),
          body: JSON.stringify({
            action: 'respond',
            resourceId,
            audience: 'CLIENT_PROGRESS',
            ...command,
          }),
        }),
      );
      const result = value as {
        resourceId?: unknown;
        response?: { id?: unknown; claimStatus?: unknown };
      };
      if (
        result?.resourceId !== resourceId ||
        result.response?.id !== command.commandId ||
        result.response.claimStatus !== 'self_declared'
      )
        throw new Error('failed');
      if (!task.signal.aborted) {
        setPending(null);
        setDrafts((old) => {
          const next = { ...old };
          delete next[requestId];
          return next;
        });
        setNotice('Response recorded as your self-declaration. It still requires review.');
        setBusy(false);
        read();
      }
    } catch (error) {
      if (!task.signal.aborted) {
        if (error instanceof Error && error.message === 'denied') {
          setData(null);
          setPending(null);
          setDrafts({});
          pendingBooks.clear();
          setBookDenial(null);
          setStatus('denied');
          setNotice(
            'Access or request state changed. Local response recovery was cleared for privacy.',
          );
        } else if (error instanceof Error && error.message === 'limit')
          // Nothing was processed, so the same command stays ready to send again later.
          setNotice(limitWords);
        else
          setNotice(
            'Response delivery could not be confirmed. Retry the same response before changing it.',
          );
      }
    } finally {
      inFlight.current = false;
      if (!task.signal.aborted) setBusy(false);
    }
  }
  const showCompare = section === 'all' || section === 'compare';
  const showEvidence = section === 'all' || section === 'evidence';
  const showRest = section === 'all';
  const showTrip = section === 'trip';
  // The member read is read only: none of the panels that act on the report or speak for its owner are drawn.
  const showDecisions = decisionsEnabled && !member;
  const showConfirmations = specificationConfirmationsEnabled && !member;
  const bookTarget: BookTarget | undefined = member && {
    endpoint: memberEndpoint,
    fields: { action: 'book', workspaceId: member.workspaceId },
  };
  if (section === 'none') return null;
  return (
    <section
      className="delivery-view ux-saved-commercial-report"
      aria-label="Approved saved commercial report"
    >
      {showRest && !member && (
        <a className="text-link ux-back" href="/account#saved-commercial-missions">
          Back to my saved commercial missions
        </a>
      )}
      {!(member && realCustomerInput()) && (
        <p>
          {realCustomerInput()
            ? 'Your submitted information. This is the operator-approved report scope, not automatic access to every company, contact, offer or participant record.'
            : 'Sample data only. This is the operator-approved report scope, not automatic access to every company, contact, offer or participant record.'}{' '}
        </p>
      )}
      {member && source && status === 'ready' && (
        <p>
          Saved by {source.label ?? 'a member of this workspace'}
          {source.workspaceName ? ` in ${source.workspaceName}` : ''}. You can read it and download
          its books. You cannot change or remove it.
        </p>
      )}
      {status === 'loading' && (
        <p role="status">
          {member ? 'Opening this report…' : 'Opening your approved commercial report…'}
        </p>
      )}
      {status === 'denied' && bookDenial && (
        <>
          <p role="alert" tabIndex={-1} ref={bookAlert}>
            {bookDenial.message}
          </p>
          {bookDenial.signedOut && (
            <a className="text-link" href="/signin">
              {translate('en', 'books.signInAgain')}
            </a>
          )}
        </>
      )}
      {status === 'denied' && !bookDenial && (
        <p role="alert">
          {member
            ? 'This report is not available to you. It may have been removed by the member who saved it, or your access changed. No report content is shown.'
            : 'This saved mission is unavailable or access could not be confirmed. No commercial report content is shown.'}
        </p>
      )}
      {status === 'unavailable' && (
        <p role="status">
          {member
            ? 'Reports are not available right now. Try again later.'
            : 'Saved commercial reports are temporarily unavailable. Your original invitation is separate.'}
        </p>
      )}
      {status === 'failed' && (
        <p role="alert">
          {member
            ? 'This report could not be loaded. Try again.'
            : 'Your approved report could not be loaded. Try again.'}
        </p>
      )}
      {status === 'closed' && (
        <p role="status">
          This report closed when you left the page. Reload the page to open it again.
        </p>
      )}
      {status === 'limit' && <p role="alert">{limitWords}</p>}
      {data && status === 'ready' && (
        <>
          <p>
            Approved purpose: {data.purpose}. Original access expires {formatMoment(data.expiresAt)}
            .
          </p>
          <PrivacyLabel surface="savedReport" />
          {data.missions.map((m) => {
            const intro = showCompare && showRest && (
              <>
                <MissionPassport mission={m} />
                <h2>Commercial objective</h2>
                <p>{m.objective}</p>
                <p>{m.brief}</p>
              </>
            );
            const companies = showCompare && (
              <>
                {m.experience ? (
                  <details className="ux-mission-detail" open>
                    <summary>
                      Companies, qualification, requirements and original quotations
                    </summary>
                    <MissionExperienceView experience={m.experience} lenses={lenses} />
                  </details>
                ) : (
                  <p>
                    No company shortlist or supplier quotation has been approved for this report
                    yet.
                  </p>
                )}
              </>
            );
            const trip = showTrip && renderTrip && renderTrip(m.itinerary);
            const decisions = (
              <>
                {showEvidence && showDecisions && (
                  <DecisionHistory
                    subject={subject}
                    issuer={issuer}
                    resourceId={resourceId}
                    cards={decisionCards}
                    memberAccess={memberAccess}
                  />
                )}
                {showEvidence && showConfirmations && (
                  <SpecificationConfirmation
                    subject={subject}
                    issuer={issuer}
                    resourceId={resourceId}
                  />
                )}
              </>
            );
            const meetings = showRest && (
              <>
                <h2>Meetings and visits</h2>
                {m.itinerary.length ? (
                  <ul>
                    {m.itinerary.map((meeting, index) => (
                      <li key={index}>
                        <strong>{meeting.label}</strong> · {meetingStatusWords(meeting.status)}
                        <p>
                          {meeting.scheduleChanged
                            ? 'The schedule changed. A new reviewed itinerary is required.'
                            : meeting.startsAt
                              ? formatMoment(meeting.startsAt, meeting.timezone ?? 'UTC') +
                                ' · ' +
                                (meeting.location ?? 'Location not supplied')
                              : 'No confirmed appointment time supplied.'}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="ux-empty">
                    No meetings or visits have been approved for this itinerary yet.
                  </p>
                )}
                <h2>Recorded commercial progress</h2>
                <p>
                  Qualified opportunities: {m.outcomes.qualified}. Proposals: {m.outcomes.proposals}
                  . Contracts: {m.outcomes.contracts}. Meetings held: {m.outcomes.heldMeetings}.
                </p>
                {m.totals.length ? (
                  <ul>
                    {m.totals.map((t) => (
                      <li key={t.currency}>
                        Customer contracts {displayMoney(t.contractMinor, t.currency)} · Invoices{' '}
                        {displayMoney(t.invoiceMinor, t.currency)} · Confirmed cash{' '}
                        {displayMoney(t.confirmedCashMinor, t.currency)} · Repeat cash{' '}
                        {displayMoney(t.repeatCashMinor, t.currency)} (included in confirmed cash).
                        These are customer trade observations, not Corridra or organiser revenue.
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    No financial amounts are shared in this report. Missing shared amounts do not
                    mean zero.
                  </p>
                )}
              </>
            );
            const evidenceRequests = (
              <>
                {showEvidence && m.requests && (
                  <section>
                    <h2>Evidence requests and declarations</h2>
                    {m.requests.length === 0 ? (
                      <p>No evidence responses are requested.</p>
                    ) : (
                      m.requests.map((q) => (
                        <article key={q.id}>
                          <h3>{q.title}</h3>
                          <p>{q.instructions}</p>
                          <p>
                            {evidenceRequestStatusWords(q.status)} · Due {formatUtcDay(q.dueAt)}
                          </p>
                          {q.response && (
                            <p>
                              {member
                                ? "The member's self-declared response:"
                                : 'Your self-declared response:'}{' '}
                              {q.response}
                            </p>
                          )}
                          {!member && (q.status === 'OPEN' || pending?.requestId === q.id) && (
                            <form
                              className="operator-form"
                              onSubmit={(event) => {
                                event.preventDefault();
                                void respond(q.id);
                              }}
                            >
                              <fieldset disabled={busy || !!pending}>
                                <legend>Reply to this evidence request</legend>
                                <div className="field">
                                  <label htmlFor={responsePrefix + q.id}>Your response</label>
                                  <textarea
                                    id={responsePrefix + q.id}
                                    name="body"
                                    minLength={3}
                                    maxLength={2000}
                                    required
                                    value={drafts[q.id]?.body ?? ''}
                                    onChange={(event) =>
                                      setDrafts((old) => ({
                                        ...old,
                                        [q.id]: {
                                          body: event.target.value,
                                          acknowledged: old[q.id]?.acknowledged ?? false,
                                        },
                                      }))
                                    }
                                  />
                                </div>
                                <label>
                                  <input
                                    type="checkbox"
                                    required
                                    checked={drafts[q.id]?.acknowledged ?? false}
                                    onChange={(event) =>
                                      setDrafts((old) => ({
                                        ...old,
                                        [q.id]: {
                                          body: old[q.id]?.body ?? '',
                                          acknowledged: event.target.checked,
                                        },
                                      }))
                                    }
                                  />{' '}
                                  This is my self-declared response. Supporting documents must
                                  follow the operator-controlled review process.
                                </label>
                              </fieldset>
                              <button
                                className="primary-link"
                                disabled={busy || (!!pending && pending.requestId !== q.id)}
                              >
                                {pending?.requestId === q.id
                                  ? 'Retry Same Response'
                                  : 'Send Response'}
                              </button>
                              {pending?.requestId === q.id && (
                                <button
                                  type="button"
                                  className="text-link"
                                  disabled={busy}
                                  onClick={() => {
                                    setPending(null);
                                    setNotice(
                                      'Local retry cleared. This does not cancel or change any response already recorded. Refresh the report before sending different information.',
                                    );
                                  }}
                                >
                                  Clear Local Response Retry
                                </button>
                              )}
                            </form>
                          )}
                        </article>
                      ))
                    )}
                    {!member && (
                      <p>
                        Your original private invitation also remains available in{' '}
                        <a className="text-link" href="/account#customer-missions">
                          My shared missions
                        </a>
                        . Responses are self-declarations, not verified conclusions or supplier
                        quotations.
                      </p>
                    )}
                  </section>
                )}
              </>
            );
            const downloads = (
              <>
                {showRest && books && (
                  <BookDownloads
                    subject={subject}
                    issuer={issuer}
                    resourceId={resourceId}
                    tripCount={m.itinerary.length}
                    supplierCount={m.experience?.shortlist.length ?? 0}
                    pending={pendingBooks}
                    onDenied={bookDenied}
                    onChanged={read}
                    target={bookTarget}
                  />
                )}
              </>
            );
            // The whole page is cut into tabs so it fits the page-length budget; the Room's lenses draw single parts and
            // keep the plain order. Every part stays in the page, hidden unless its tab is chosen.
            return (
              <article className="delivery-card ux-participant-mission" key={m.publicationId}>
                {section === 'all' ? (
                  <>
                    {intro}
                    <SubTabs
                      label="Report sections"
                      tabs={[
                        { id: 'companies', label: 'Companies and Quotes', panel: companies },
                        { id: 'meetings', label: 'Meetings and Progress', panel: meetings },
                        ...(showDecisions || showConfirmations || m.requests
                          ? [
                              {
                                id: 'evidence',
                                label: 'Evidence and Decisions',
                                panel: (
                                  <>
                                    {decisions}
                                    {evidenceRequests}
                                  </>
                                ),
                              },
                            ]
                          : []),
                        ...(books
                          ? [{ id: 'downloads', label: 'Downloads', panel: downloads }]
                          : []),
                      ]}
                    />
                  </>
                ) : (
                  <>
                    {intro}
                    {companies}
                    {trip}
                    {decisions}
                    {meetings}
                    {evidenceRequests}
                    {downloads}
                  </>
                )}
              </article>
            );
          })}
          <p>{data.attribution}</p>
        </>
      )}
      {status !== 'loading' && (
        <button
          className="text-link"
          type="button"
          onClick={() => {
            setData(null);
            setStatus('loading');
            read();
          }}
        >
          Refresh Approved Commercial Report
        </button>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
