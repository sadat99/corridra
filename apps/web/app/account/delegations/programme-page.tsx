'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import { ProgrammePageView } from '../../delegations/[address]/programme-page-view';
import '../../delegations/[address]/programme-page.css';
import { customerHeaders, useCommandIds } from './pricing-client';
import {
  type Application,
  type PageView,
  type PublicCopy,
  pageRequest,
  parseApplication,
  parsePageView,
  shortDay,
  statusWords,
} from './programme-page-client';

type Props = {
  subject: string;
  issuer: string;
  workspaceId: string;
  programmeId: string;
  programmeName: string;
};
// What the organiser types. Lists are typed one item per line; the planned programme marks each line.
type Draft = {
  title: string;
  organiser: string;
  summary: string;
  destination: string;
  dates: string;
  focus: string;
  audience: string;
  eligibility: string;
  capacity: string;
  activities: string;
  confirmed: string[];
  fee: string;
  included: string;
  excluded: string;
  closes: string;
};
const steps = [
  'Basics',
  'Where and when',
  'Who it is for',
  'The programme',
  'Fee',
  'Check and publish',
];
const lines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
const isoDay = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
function emptyDraft(name: string): Draft {
  return {
    title: name,
    organiser: '',
    summary: '',
    destination: '',
    dates: '',
    focus: '',
    audience: '',
    eligibility: '',
    capacity: '',
    activities: '',
    confirmed: [],
    fee: '',
    included: '',
    excluded: '',
    closes: isoDay(30),
  };
}
function draftFrom(copy: PublicCopy, closesAt?: string): Draft {
  const later = closesAt && Date.parse(closesAt) > Date.now() + 86400000;
  return {
    title: copy.title,
    organiser: copy.organiser,
    summary: copy.summary,
    destination: copy.destination,
    dates: copy.dates,
    focus: copy.focus,
    audience: copy.audience,
    eligibility: copy.eligibility,
    capacity: copy.capacity ? String(copy.capacity) : '',
    activities: copy.activities.map((item) => item.label).join('\n'),
    confirmed: copy.activities.filter((item) => item.status === 'CONFIRMED').map((i) => i.label),
    fee: copy.fee ?? '',
    included: copy.included.join('\n'),
    excluded: copy.excluded.join('\n'),
    closes: later ? closesAt.slice(0, 10) : isoDay(30),
  };
}
function copyFrom(draft: Draft): PublicCopy {
  const capacity = Number.parseInt(draft.capacity, 10);
  return {
    title: draft.title.trim(),
    organiser: draft.organiser.trim(),
    summary: draft.summary.trim(),
    destination: draft.destination.trim(),
    dates: draft.dates.trim(),
    focus: draft.focus.trim(),
    audience: draft.audience.trim(),
    eligibility: draft.eligibility.trim(),
    activities: lines(draft.activities).map((label) => ({
      label,
      status: draft.confirmed.includes(label) ? 'CONFIRMED' : 'PLANNED',
    })),
    included: lines(draft.included),
    excluded: lines(draft.excluded),
    ...(draft.fee.trim() ? { fee: draft.fee.trim() } : {}),
    ...(Number.isInteger(capacity) && draft.capacity.trim() ? { capacity } : {}),
  };
}
const between = (text: string, min: number, max: number) => {
  const n = [...text.trim()].length;
  return n >= min && n <= max;
};
// The first thing wrong with one step, in plain words, or nothing. The database checks all of it again.
function problem(step: number, draft: Draft, sample: boolean): string {
  const mark = (text: string) => !sample || text.trim().startsWith('Synthetic ');
  if (step === 0) {
    if (!between(draft.title, sample ? 11 : 3, 160)) return 'Write a title of 3 to 160 characters.';
    if (!between(draft.organiser, sample ? 11 : 2, 160)) return 'Write the name of the organiser.';
    if (!mark(draft.title) || !mark(draft.organiser))
      return 'This is a sample workspace. Start the title and the organiser name with "Synthetic ".';
    if (!between(draft.summary, 10, 1200))
      return 'Say in one or two sentences what the programme is for (10 to 1200 characters).';
  }
  if (step === 1) {
    if (!between(draft.destination, 2, 160)) return 'Write where the programme goes.';
    if (!between(draft.dates, 2, 160))
      return 'Write the dates. If they are not fixed, say so, for example "April 2027, to be confirmed".';
    if (!between(draft.focus, 2, 300)) return 'Write the industry or business focus.';
  }
  if (step === 2) {
    if (!between(draft.audience, 10, 600)) return 'Say who should apply (10 to 600 characters).';
    if (!between(draft.eligibility, 10, 600))
      return 'Say what a company needs to take part (10 to 600 characters).';
    if (draft.capacity.trim() && !/^([1-9][0-9]{0,2}|1000)$/.test(draft.capacity.trim()))
      return 'Places must be a whole number from 1 to 1000, or left empty.';
  }
  if (step === 3) {
    const items = lines(draft.activities);
    if (items.length > 12) return 'List at most 12 visits or meetings.';
    if (items.some((item) => !between(item, 3, 160)))
      return 'Each line must be 3 to 160 characters.';
    if (new Set(items).size !== items.length) return 'Two lines are the same. Change one of them.';
  }
  if (step === 4) {
    if (draft.fee.trim() && !between(draft.fee, 2, 300)) return 'The fee line is too long.';
    for (const list of [lines(draft.included), lines(draft.excluded)]) {
      if (list.length > 8) return 'List at most 8 lines in each box.';
      if (list.some((item) => !between(item, 2, 160)))
        return 'Each line must be 2 to 160 characters.';
    }
  }
  if (step === 5) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(draft.closes) ||
      draft.closes < isoDay(1) ||
      draft.closes > isoDay(179)
    )
      return 'Choose a closing date from tomorrow up to 179 days from now.';
  }
  return '';
}
const stateWords: Record<PageView['state'], string> = {
  NONE: 'Not published',
  OPEN: 'Published and taking applications',
  CLOSED: 'Published, applications closed',
  ENDED: 'Closed for more than 30 days: the page is no longer shown',
  WITHDRAWN: 'Taken down',
  PAUSED: 'Not shown while the programme or workspace is archived',
};

/** The organiser's side of the public programme page: write, preview, publish, share, take down and answer
 * applications. Everything shown to the public is the copy written here and nothing else. */
export function ProgrammePage(props: Props) {
  return (
    <ScopedPage
      key={props.issuer + ':' + props.subject + ':' + props.workspaceId + ':' + props.programmeId}
      {...props}
    />
  );
}

function ScopedPage({ subject, issuer, workspaceId, programmeId, programmeName }: Props) {
  const headers = customerHeaders(subject, issuer);
  const headersRef = useRef(headers);
  const commands = useCommandIds();
  const sample = !realCustomerInput();
  const storageKey = `corridra.programme-page.${programmeId}`;
  const [view, setView] = useState<PageView | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [nextAfter, setNextAfter] = useState<string | null>(null);
  const [load, setLoad] = useState<'loading' | 'ready' | 'denied' | 'unavailable' | 'failed'>(
    'loading',
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [step, setStep] = useState(0);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [copied, setCopied] = useState('');
  const [origin, setOrigin] = useState('');
  const writing = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  const read = useCallback(async () => {
    const scope = `workspaceId=${workspaceId}&programmeId=${programmeId}`;
    try {
      const [page, list] = await Promise.all(
        ['page', 'applications'].map((kind) =>
          fetch(`/api/customer-programme-pages?view=${kind}&${scope}`, {
            cache: 'no-store',
            credentials: 'same-origin',
            headers: headersRef.current,
          }),
        ),
      );
      if ([401, 403].includes(page!.status)) return setLoad('denied');
      if (page!.status === 503) return setLoad('unavailable');
      if (!page!.ok || !list!.ok) return setLoad('failed');
      const parsed = parsePageView(await page!.json());
      const body = (await list!.json()) as { applications?: unknown[]; nextAfter?: string | null };
      setView(parsed);
      setApplications((body.applications ?? []).map(parseApplication));
      setNextAfter(typeof body.nextAfter === 'string' ? body.nextAfter : null);
      setLoad('ready');
    } catch {
      setLoad('failed');
    }
  }, [workspaceId, programmeId]);
  useEffect(() => {
    // The read starts after this effect returns; state changes only when it settles.
    void Promise.resolve().then(() => {
      setOrigin(window.location.origin);
      return read();
    });
  }, [read]);
  // Typed words are kept in this browser until they are published, so a reload or a lost connection loses nothing.
  useEffect(() => {
    if (!draft) return;
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(draft));
    } catch {
      /* Storage can be unavailable; the words stay on the screen. */
    }
  }, [draft, storageKey]);
  useEffect(() => {
    if (draft) heading.current?.focus();
  }, [step, draft === null]); // eslint-disable-line react-hooks/exhaustive-deps

  function startEditing() {
    let kept: Draft | null = null;
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      if (raw) kept = { ...emptyDraft(programmeName), ...(JSON.parse(raw) as Partial<Draft>) };
    } catch {
      kept = null;
    }
    setDraft(
      kept ?? (view?.copy ? draftFrom(view.copy, view.closesAt) : emptyDraft(programmeName)),
    );
    setStep(0);
    setAgreed(false);
    setError('');
    setNotice('');
  }
  function stopEditing() {
    setDraft(null);
    setError('');
  }
  const set = (key: keyof Draft) => (value: string) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  function forward() {
    if (!draft) return;
    const wrong = problem(step, draft, sample);
    setError(wrong);
    if (!wrong) setStep((s) => Math.min(s + 1, steps.length - 1));
  }
  async function publish() {
    if (!draft || !view || writing.current) return;
    for (let s = 0; s < steps.length; s++) {
      const wrong = problem(s, draft, sample);
      if (wrong) {
        setStep(s);
        setError(wrong);
        return;
      }
    }
    if (!agreed) {
      setError('Tick the box to confirm you checked the page before it goes public.');
      return;
    }
    writing.current = true;
    setBusy(true);
    setError('');
    const copy = copyFrom(draft);
    const closesAt = `${draft.closes}T23:59:00.000Z`;
    const result = await pageRequest(headers, {
      kind: 'page',
      action: 'publish',
      commandId: commands.forIntent('publish' + view.version + JSON.stringify(copy) + closesAt),
      workspaceId,
      programmeId,
      expectedVersion: view.version,
      copy,
      closesAt,
      acknowledged: true,
    });
    writing.current = false;
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    commands.clear();
    try {
      window.sessionStorage.removeItem(storageKey);
    } catch {
      /* Nothing to clear. */
    }
    setDraft(null);
    setNotice('Published. The page is public at its address below.');
    await read();
  }
  async function takeDown() {
    if (!view || writing.current) return;
    if (!window.confirm('Take the page down? The address stops working until you publish again.'))
      return;
    writing.current = true;
    setBusy(true);
    setError('');
    const result = await pageRequest(headers, {
      kind: 'page',
      action: 'withdraw',
      commandId: commands.forIntent('withdraw' + view.version),
      workspaceId,
      programmeId,
      acknowledged: true,
    });
    writing.current = false;
    setBusy(false);
    if (!result.ok) return setError(result.message);
    commands.clear();
    setNotice('The page is taken down. Applications already made are kept.');
    await read();
  }
  async function decide(item: Application, decision: 'INVITED' | 'WAITLISTED' | 'DECLINED') {
    if (writing.current) return;
    const note = decision === 'DECLINED' ? reason.trim() : '';
    if (decision === 'DECLINED' && !between(note, 10, 500)) {
      setRowError({
        id: item.id,
        message: 'Write a short reason the applicant will read (10 to 500 characters).',
      });
      return;
    }
    writing.current = true;
    setBusy(true);
    setRowError(null);
    const result = await pageRequest(headers, {
      kind: 'application',
      action: 'decide',
      commandId: commands.forIntent('decide' + item.id + item.decisionVersion + decision + note),
      workspaceId,
      programmeId,
      applicationId: item.id,
      expectedVersion: item.decisionVersion,
      decision,
      ...(note ? { note } : {}),
      acknowledged: true,
    });
    writing.current = false;
    setBusy(false);
    if (!result.ok) {
      setRowError({ id: item.id, message: result.message });
      return;
    }
    setDeclining(null);
    setReason('');
    try {
      const updated = parseApplication(result.body);
      setApplications((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
    } catch {
      await read();
    }
  }
  async function more() {
    if (!nextAfter) return;
    const r = await fetch(
      `/api/customer-programme-pages?view=applications&workspaceId=${workspaceId}&programmeId=${programmeId}&after=${nextAfter}`,
      { cache: 'no-store', credentials: 'same-origin', headers },
    ).catch(() => null);
    if (!r?.ok) return setError('More applications could not be loaded. Try again.');
    const body = (await r.json()) as { applications?: unknown[]; nextAfter?: string | null };
    setApplications((rows) => [...rows, ...(body.applications ?? []).map(parseApplication)]);
    setNextAfter(typeof body.nextAfter === 'string' ? body.nextAfter : null);
  }
  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied('Link copied.');
    } catch {
      setCopied(`Copy this link: ${url}`);
    }
  }

  if (load === 'loading') return <p role="status">Loading the public page…</p>;
  if (load === 'unavailable')
    return <p className="programme-note">Public programme pages are not available yet.</p>;
  if (load === 'denied')
    return <p role="alert">Only owners and admins of this workspace can manage the public page.</p>;
  if (load === 'failed' || !view)
    return (
      <div role="alert">
        <p>The public page could not be loaded. Nothing was changed.</p>
        <button type="button" className="text-link" onClick={() => void read()}>
          Try Again
        </button>
      </div>
    );

  const url = view.address && origin ? `${origin}/delegations/${view.address}` : '';
  const shown = view.state === 'OPEN' || view.state === 'CLOSED';

  if (draft) {
    const field = (
      key: keyof Draft,
      label: string,
      hint: string,
      options: { area?: boolean; type?: string; max?: number } = {},
    ) => (
      <label className="field">
        <span>{label}</span>
        {options.area ? (
          <textarea
            name={`page-${key}`}
            rows={4}
            maxLength={options.max}
            value={draft[key] as string}
            onChange={(event) => set(key)(event.target.value)}
          />
        ) : (
          <input
            name={`page-${key}`}
            type={options.type ?? 'text'}
            maxLength={options.max}
            min={options.type === 'date' ? isoDay(1) : undefined}
            max={options.type === 'date' ? isoDay(179) : undefined}
            inputMode={key === 'capacity' ? 'numeric' : undefined}
            value={draft[key] as string}
            onChange={(event) => set(key)(event.target.value)}
          />
        )}
        <small>{hint}</small>
      </label>
    );
    const planned = lines(draft.activities);
    return (
      <form
        className="programme-page-editor"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (step === steps.length - 1) void publish();
          else forward();
        }}
      >
        <h5 ref={heading} tabIndex={-1}>
          Step {step + 1} of {steps.length}: {steps[step]}
        </h5>
        <progress max={steps.length} value={step + 1} aria-label="Progress through the page">
          {step + 1} of {steps.length}
        </progress>
        {step === 0 && (
          <>
            {field('title', 'Title', 'What the delegation is called in public.', { max: 160 })}
            {field('organiser', 'Organised by', 'Your organisation or your own name.', {
              max: 160,
            })}
            {field('summary', 'What it is for', 'One or two sentences. One paragraph.', {
              area: true,
              max: 1200,
            })}
          </>
        )}
        {step === 1 && (
          <>
            {field('destination', 'Where', 'City and country, for example "Guangzhou, China".', {
              max: 160,
            })}
            {field('dates', 'When', 'If the dates are not fixed yet, say so.', { max: 160 })}
            {field('focus', 'Industry or business focus', 'For example "Agricultural machinery".', {
              max: 300,
            })}
          </>
        )}
        {step === 2 && (
          <>
            {field('audience', 'Who should apply', 'The kind of company and person.', {
              area: true,
              max: 600,
            })}
            {field('eligibility', 'What a company needs to take part', 'Your own conditions.', {
              area: true,
              max: 600,
            })}
            {field('capacity', 'Places (optional)', 'How many companies you plan to take.', {
              max: 4,
            })}
          </>
        )}
        {step === 3 && (
          <>
            {field(
              'activities',
              'Visits and meetings (optional)',
              'One per line, up to 12. Each is shown as Planned unless you mark it confirmed below.',
              { area: true },
            )}
            {planned.length > 0 && (
              <fieldset className="programme-page-confirm">
                <legend>Mark only what is already confirmed</legend>
                {planned.map((label) => (
                  <label key={label}>
                    <input
                      type="checkbox"
                      checked={draft.confirmed.includes(label)}
                      onChange={(event) =>
                        setDraft((d) =>
                          d
                            ? {
                                ...d,
                                confirmed: event.target.checked
                                  ? [...d.confirmed, label]
                                  : d.confirmed.filter((item) => item !== label),
                              }
                            : d,
                        )
                      }
                    />{' '}
                    {label}
                  </label>
                ))}
              </fieldset>
            )}
          </>
        )}
        {step === 4 && (
          <>
            {field('fee', 'Fee (optional)', 'The amount, the currency and who it is paid to.', {
              max: 300,
            })}
            {field('included', 'Included (optional)', 'One per line, up to 8.', { area: true })}
            {field('excluded', 'Not included (optional)', 'One per line, up to 8.', { area: true })}
          </>
        )}
        {step === 5 && (
          <>
            {field(
              'closes',
              'Applications close on',
              'End of that day, UTC. You can reopen later.',
              {
                type: 'date',
              },
            )}
            <details className="programme-page-preview" open>
              <summary>Preview: this is exactly what the public will read</summary>
              <ProgrammePageView
                preview
                page={{
                  state: 'OPEN',
                  programme: copyFrom(draft),
                  closesAt: `${draft.closes}T23:59:00.000Z`,
                  sample: view.sample,
                }}
              />
            </details>
            <label className="programme-page-agree">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(event) => setAgreed(event.target.checked)}
              />{' '}
              I checked this page. It contains no private contact, price list or participant detail,
              and I am allowed to publish it.
            </label>
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="guide-actions-row">
          <button type="submit" className="primary-link" disabled={busy}>
            {step === steps.length - 1 ? (busy ? 'Publishing…' : 'Publish the Page') : 'Continue'}
          </button>
          {step > 0 && (
            <button
              type="button"
              className="text-link"
              onClick={() => {
                setError('');
                setStep((s) => s - 1);
              }}
            >
              Back
            </button>
          )}
          <button type="button" className="text-link" onClick={stopEditing}>
            Close and Keep Draft
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="programme-page-panel">
      <p>
        <strong>Public page:</strong> {stateWords[view.state]}
        {view.state === 'OPEN' && view.closesAt ? ` until ${shortDay(view.closesAt)} (UTC)` : ''}
        {view.version > 0 ? ` · version ${view.version}` : ''}
      </p>
      {view.state === 'NONE' && (
        <p className="programme-note">
          Publish a page to let companies read about this programme and apply. Only the words you
          write for the page become public. Participants, prices and private requests stay private.
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      {shown && url && (
        <>
          <p className="programme-page-address">
            <a className="text-link" href={url} target="_blank" rel="noopener noreferrer">
              {url}
            </a>
          </p>
          <div className="guide-actions-row">
            <button type="button" className="text-link" onClick={() => void copyLink(url)}>
              Copy Link
            </button>
            <a
              className="text-link"
              href={`https://wa.me/?text=${encodeURIComponent(`${view.copy?.title ?? ''} ${url}`)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Share on WhatsApp
            </a>
            <a
              className="text-link"
              href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Share on Facebook
            </a>
          </div>
          <p role="status" className="programme-note">
            {copied}
          </p>
        </>
      )}
      <div className="guide-actions-row">
        <button type="button" className="primary-link" onClick={startEditing} disabled={busy}>
          {view.version === 0
            ? 'Write the Public Page'
            : shown
              ? 'Edit the Page'
              : 'Edit and Publish Again'}
        </button>
        {shown && (
          <button
            type="button"
            className="text-link"
            onClick={() => void takeDown()}
            disabled={busy}
          >
            Take the Page Down
          </button>
        )}
      </div>
      {view.version > 0 && (
        <section aria-label="Applications" className="programme-page-applications">
          <h5>
            Applications: {view.awaiting} waiting for your answer, {view.applications} in all
          </h5>
          {applications.length === 0 ? (
            <p className="ux-empty">
              No applications yet. Share the page address with the companies you want to reach.
            </p>
          ) : (
            <ul>
              {applications.map((item) => (
                <li key={item.id}>
                  <p>
                    <strong>{item.displayLabel}</strong>{' '}
                    <span className="programme-public-state">{statusWords[item.status]}</span>
                  </p>
                  <p>{item.statement}</p>
                  <p className="programme-note">
                    Applied {shortDay(item.appliedAt)}. Stated by the applicant, not checked.
                    {item.status === 'INVITED' && item.invitationExpiresAt
                      ? ` Invitation can be used until ${shortDay(item.invitationExpiresAt)}.`
                      : ''}
                    {item.note ? ` Your note: ${item.note}` : ''}
                  </p>
                  {item.status === 'JOINED' && (
                    <p className="programme-note">
                      Registered. Terms, places and fees for this participant are under Participants
                      and Terms.
                    </p>
                  )}
                  {declining === item.id ? (
                    <div className="programme-page-decline">
                      <label className="field">
                        <span>Reason the applicant will read</span>
                        <textarea
                          rows={3}
                          maxLength={500}
                          value={reason}
                          onChange={(event) => setReason(event.target.value)}
                        />
                      </label>
                      <div className="guide-actions-row">
                        <button
                          type="button"
                          className="text-link"
                          disabled={busy}
                          onClick={() => void decide(item, 'DECLINED')}
                        >
                          Confirm Decline
                        </button>
                        <button
                          type="button"
                          className="text-link"
                          onClick={() => {
                            setDeclining(null);
                            setRowError(null);
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    [
                      'SUBMITTED',
                      'WAITLISTED',
                      'DECLINED',
                      'INVITED',
                      'INVITATION_EXPIRED',
                    ].includes(item.status) && (
                      <div className="guide-actions-row">
                        {item.status !== 'INVITED' && (
                          <button
                            type="button"
                            className="text-link"
                            disabled={busy}
                            onClick={() => void decide(item, 'INVITED')}
                          >
                            {item.status === 'INVITATION_EXPIRED'
                              ? 'Invite Again'
                              : 'Invite to Join'}
                          </button>
                        )}
                        {['SUBMITTED', 'DECLINED', 'INVITATION_EXPIRED'].includes(item.status) && (
                          <button
                            type="button"
                            className="text-link"
                            disabled={busy}
                            onClick={() => void decide(item, 'WAITLISTED')}
                          >
                            Put on Waiting List
                          </button>
                        )}
                        {item.status !== 'DECLINED' && (
                          <button
                            type="button"
                            className="text-link"
                            disabled={busy}
                            onClick={() => {
                              setDeclining(item.id);
                              setReason('');
                              setRowError(null);
                            }}
                          >
                            Decline
                          </button>
                        )}
                      </div>
                    )
                  )}
                  {rowError?.id === item.id && <p role="alert">{rowError.message}</p>}
                </li>
              ))}
            </ul>
          )}
          {nextAfter && (
            <button type="button" className="text-link" onClick={() => void more()}>
              Show More Applications
            </button>
          )}
        </section>
      )}
    </div>
  );
}
