'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import { ProgrammePageView } from '../../delegations/[address]/programme-page-view';
import '../../delegations/[address]/programme-page.css';
import { pp } from '../../../lib/i18n/programme-pages';
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
export type Draft = {
  title: string;
  organiser: string;
  summary: string;
  destination: string;
  dates: string;
  /** Optional calendar days (ADR-084 S1). Kept apart from the free text above, which the page shows as written. */
  startsOn: string;
  endsOn: string;
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
  pp('pp.edit.step.basics'),
  pp('pp.edit.step.where'),
  pp('pp.edit.step.who'),
  pp('pp.edit.step.programme'),
  pp('pp.edit.step.fee'),
  pp('pp.edit.step.publish'),
];
const lines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
export const isoDay = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
export function emptyDraft(name: string): Draft {
  return {
    title: name,
    organiser: '',
    summary: '',
    destination: '',
    dates: '',
    startsOn: '',
    endsOn: '',
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
function draftFrom(
  copy: PublicCopy,
  closesAt?: string,
  schedule?: { startsOn: string; endsOn: string } | null,
): Draft {
  const later = closesAt && Date.parse(closesAt) > Date.now() + 86400000;
  return {
    title: copy.title,
    organiser: copy.organiser,
    summary: copy.summary,
    destination: copy.destination,
    dates: copy.dates,
    startsOn: schedule?.startsOn ?? '',
    endsOn: schedule?.endsOn ?? '',
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
export function copyFrom(draft: Draft): PublicCopy {
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
export function problem(step: number, draft: Draft, sample: boolean): string {
  const mark = (text: string) => !sample || text.trim().startsWith('Synthetic ');
  if (step === 0) {
    if (!between(draft.title, sample ? 11 : 3, 160)) return pp('pp.edit.problem.title');
    if (!between(draft.organiser, sample ? 11 : 2, 160)) return pp('pp.edit.problem.organiser');
    if (!mark(draft.title) || !mark(draft.organiser)) return pp('pp.edit.problem.sample');
    if (!between(draft.summary, 10, 1200)) return pp('pp.edit.problem.summary');
  }
  if (step === 1) {
    if (!between(draft.destination, 2, 160)) return pp('pp.edit.problem.destination');
    if (!between(draft.dates, 2, 160)) return pp('pp.edit.problem.dates');
    if (!between(draft.focus, 2, 300)) return pp('pp.edit.problem.focus');
  }
  if (step === 2) {
    if (!between(draft.audience, 10, 600)) return pp('pp.edit.problem.audience');
    if (!between(draft.eligibility, 10, 600)) return pp('pp.edit.problem.eligibility');
    if (draft.capacity.trim() && !/^([1-9][0-9]{0,2}|1000)$/.test(draft.capacity.trim()))
      return pp('pp.edit.problem.capacity');
  }
  if (step === 3) {
    const items = lines(draft.activities);
    if (items.length > 12) return pp('pp.edit.problem.activitiesCount');
    if (items.some((item) => !between(item, 3, 160))) return pp('pp.edit.problem.activityLength');
    if (new Set(items).size !== items.length) return pp('pp.edit.problem.activitySame');
  }
  if (step === 4) {
    if (draft.fee.trim() && !between(draft.fee, 2, 300)) return pp('pp.edit.problem.fee');
    for (const list of [lines(draft.included), lines(draft.excluded)]) {
      if (list.length > 8) return pp('pp.edit.problem.listCount');
      if (list.some((item) => !between(item, 2, 160))) return pp('pp.edit.problem.listLength');
    }
  }
  if (step === 5) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(draft.closes) ||
      draft.closes < isoDay(1) ||
      draft.closes > isoDay(179)
    )
      return pp('pp.edit.problem.closes');
  }
  return '';
}
/** What is wrong with the optional calendar days, or nothing: both or neither, in order, at most a year apart. */
export function scheduleProblem(draft: Pick<Draft, 'startsOn' | 'endsOn'>): string {
  const { startsOn, endsOn } = draft;
  if (!startsOn && !endsOn) return '';
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!day.test(startsOn) || !day.test(endsOn) || endsOn < startsOn)
    return pp('pp.edit.problem.schedule');
  const days = (Date.parse(`${endsOn}T00:00:00Z`) - Date.parse(`${startsOn}T00:00:00Z`)) / 86400000;
  return Number.isNaN(days) || days > 365 ? pp('pp.edit.problem.schedule') : '';
}
/** The lines the guided first run asks for (ADR-084 S0). Each is one of the editor's own lines. */
export type FirstRunLine =
  | 'title'
  | 'organiser'
  | 'summary'
  | 'destination'
  | 'dates'
  | 'focus'
  | 'audience'
  | 'eligibility'
  | 'capacity'
  | 'fee'
  | 'closes';
/** The editor step that holds each of those lines, so both screens judge a line by the same rule. */
export const lineStep: Record<FirstRunLine, number> = {
  title: 0,
  organiser: 0,
  summary: 0,
  destination: 1,
  dates: 1,
  focus: 1,
  audience: 2,
  eligibility: 2,
  capacity: 2,
  fee: 4,
  closes: 5,
};
/**
 * What is wrong with one line, or nothing: the same rules and the same words as `problem`, asked one line at a
 * time, so a screen that shows the lines in another order (the guided first run) can point at the right one.
 * `tests/integration/programme-first-run.test.ts` holds the two together.
 */
export function lineProblem(key: FirstRunLine, draft: Draft, sample: boolean): string {
  const mark = (text: string) => !sample || text.trim().startsWith('Synthetic ');
  switch (key) {
    case 'title':
      if (!between(draft.title, sample ? 11 : 3, 160)) return pp('pp.edit.problem.title');
      return mark(draft.title) ? '' : pp('pp.edit.problem.sample');
    case 'organiser':
      if (!between(draft.organiser, sample ? 11 : 2, 160)) return pp('pp.edit.problem.organiser');
      return mark(draft.organiser) ? '' : pp('pp.edit.problem.sample');
    case 'summary':
      return between(draft.summary, 10, 1200) ? '' : pp('pp.edit.problem.summary');
    case 'destination':
      return between(draft.destination, 2, 160) ? '' : pp('pp.edit.problem.destination');
    case 'dates':
      return between(draft.dates, 2, 160) ? '' : pp('pp.edit.problem.dates');
    case 'focus':
      return between(draft.focus, 2, 300) ? '' : pp('pp.edit.problem.focus');
    case 'audience':
      return between(draft.audience, 10, 600) ? '' : pp('pp.edit.problem.audience');
    case 'eligibility':
      return between(draft.eligibility, 10, 600) ? '' : pp('pp.edit.problem.eligibility');
    case 'capacity':
      return draft.capacity.trim() && !/^([1-9][0-9]{0,2}|1000)$/.test(draft.capacity.trim())
        ? pp('pp.edit.problem.capacity')
        : '';
    case 'fee':
      return draft.fee.trim() && !between(draft.fee, 2, 300) ? pp('pp.edit.problem.fee') : '';
    case 'closes':
      return !/^\d{4}-\d{2}-\d{2}$/.test(draft.closes) ||
        draft.closes < isoDay(1) ||
        draft.closes > isoDay(179)
        ? pp('pp.edit.problem.closes')
        : '';
  }
}
const stateWords: Record<PageView['state'], string> = {
  NONE: pp('pp.state.NONE'),
  OPEN: pp('pp.state.OPEN'),
  CLOSED: pp('pp.state.CLOSED'),
  ENDED: pp('pp.state.ENDED'),
  WITHDRAWN: pp('pp.state.WITHDRAWN'),
  PAUSED: pp('pp.state.PAUSED'),
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
      kept ??
        (view?.copy
          ? draftFrom(view.copy, view.closesAt, view.schedule)
          : emptyDraft(programmeName)),
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
    const wrong =
      problem(step, draft, sample) || (step === 1 && view?.shareKit ? scheduleProblem(draft) : '');
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
    const wrongDays = view.shareKit ? scheduleProblem(draft) : '';
    if (wrongDays) {
      setStep(1);
      setError(wrongDays);
      return;
    }
    if (!agreed) {
      setError(pp('pp.edit.agreeNeeded'));
      return;
    }
    writing.current = true;
    setBusy(true);
    setError('');
    const copy = copyFrom(draft);
    const closesAt = `${draft.closes}T23:59:00.000Z`;
    const result = await pageRequest(
      { subject, issuer },
      {
        kind: 'page',
        action: 'publish',
        commandId: commands.forIntent('publish' + view.version + JSON.stringify(copy) + closesAt),
        workspaceId,
        programmeId,
        expectedVersion: view.version,
        copy,
        closesAt,
        acknowledged: true,
      },
    );
    if (!result.ok) {
      writing.current = false;
      setBusy(false);
      setError(result.message);
      return;
    }
    // The optional calendar days belong to the version just published (ADR-084 S1). If saving them fails the page stays
    // published and the organiser is told, so a missing calendar file is never a surprise.
    let daysSaved = true;
    const published = result.body.version;
    if (view.shareKit && draft.startsOn && draft.endsOn && typeof published === 'number') {
      const days = await pageRequest(
        { subject, issuer },
        {
          kind: 'page',
          action: 'schedule',
          commandId: commands.forIntent('schedule' + published + draft.startsOn + draft.endsOn),
          workspaceId,
          programmeId,
          version: published,
          startsOn: draft.startsOn,
          endsOn: draft.endsOn,
        },
      );
      daysSaved = days.ok;
    }
    writing.current = false;
    setBusy(false);
    commands.clear();
    try {
      window.sessionStorage.removeItem(storageKey);
    } catch {
      /* Nothing to clear. */
    }
    setDraft(null);
    setNotice(daysSaved ? pp('pp.org.published') : pp('pp.edit.schedule.failed'));
    await read();
  }
  async function takeDown() {
    if (!view || writing.current) return;
    if (!window.confirm(pp('pp.org.takeDownConfirm'))) return;
    writing.current = true;
    setBusy(true);
    setError('');
    const result = await pageRequest(
      { subject, issuer },
      {
        kind: 'page',
        action: 'withdraw',
        commandId: commands.forIntent('withdraw' + view.version),
        workspaceId,
        programmeId,
        acknowledged: true,
      },
    );
    writing.current = false;
    setBusy(false);
    if (!result.ok) return setError(result.message);
    commands.clear();
    setNotice(pp('pp.org.takenDown'));
    await read();
  }
  async function decide(item: Application, decision: 'INVITED' | 'WAITLISTED' | 'DECLINED') {
    if (writing.current) return;
    const note = decision === 'DECLINED' ? reason.trim() : '';
    if (decision === 'DECLINED' && !between(note, 10, 500)) {
      setRowError({
        id: item.id,
        message: pp('pp.org.declineReasonNeeded'),
      });
      return;
    }
    writing.current = true;
    setBusy(true);
    setRowError(null);
    const result = await pageRequest(
      { subject, issuer },
      {
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
      },
    );
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
    if (!r?.ok) return setError(pp('pp.org.applications.moreFailed'));
    const body = (await r.json()) as { applications?: unknown[]; nextAfter?: string | null };
    setApplications((rows) => [...rows, ...(body.applications ?? []).map(parseApplication)]);
    setNextAfter(typeof body.nextAfter === 'string' ? body.nextAfter : null);
  }
  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(pp('pp.share.copied'));
    } catch {
      setCopied(pp('pp.share.copyManually', { url }));
    }
  }

  if (load === 'loading') return <p role="status">{pp('pp.org.loading')}</p>;
  if (load === 'unavailable') return <p className="programme-note">{pp('pp.org.unavailable')}</p>;
  if (load === 'denied') return <p role="alert">{pp('pp.org.denied')}</p>;
  if (load === 'failed' || !view)
    return (
      <div role="alert">
        <p>{pp('pp.org.failed')}</p>
        <button type="button" className="text-link" onClick={() => void read()}>
          {pp('pp.tryAgain')}
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
          {pp('pp.edit.step', { step: step + 1, total: steps.length, name: steps[step]! })}
        </h5>
        <progress max={steps.length} value={step + 1} aria-label={pp('pp.edit.progress')}>
          {pp('pp.edit.progressValue', { step: step + 1, total: steps.length })}
        </progress>
        {step === 0 && (
          <>
            {field('title', pp('pp.edit.title.label'), pp('pp.edit.title.hint'), { max: 160 })}
            {field('organiser', pp('pp.edit.organiser.label'), pp('pp.edit.organiser.hint'), {
              max: 160,
            })}
            {field('summary', pp('pp.edit.summary.label'), pp('pp.edit.summary.hint'), {
              area: true,
              max: 1200,
            })}
          </>
        )}
        {step === 1 && (
          <>
            {field('destination', pp('pp.edit.destination.label'), pp('pp.edit.destination.hint'), {
              max: 160,
            })}
            {field('dates', pp('pp.edit.dates.label'), pp('pp.edit.dates.hint'), { max: 160 })}
            {view.shareKit && (
              <>
                <label className="field">
                  <span>{pp('pp.edit.schedule.starts')}</span>
                  <input
                    name="page-startsOn"
                    type="date"
                    value={draft.startsOn}
                    onChange={(event) => set('startsOn')(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>{pp('pp.edit.schedule.ends')}</span>
                  <input
                    name="page-endsOn"
                    type="date"
                    value={draft.endsOn}
                    onChange={(event) => set('endsOn')(event.target.value)}
                  />
                  <small>{pp('pp.edit.schedule.hint')}</small>
                </label>
              </>
            )}
            {field('focus', pp('pp.edit.focus.label'), pp('pp.edit.focus.hint'), {
              max: 300,
            })}
          </>
        )}
        {step === 2 && (
          <>
            {field('audience', pp('pp.edit.audience.label'), pp('pp.edit.audience.hint'), {
              area: true,
              max: 600,
            })}
            {field('eligibility', pp('pp.edit.eligibility.label'), pp('pp.edit.eligibility.hint'), {
              area: true,
              max: 600,
            })}
            {field('capacity', pp('pp.edit.capacity.label'), pp('pp.edit.capacity.hint'), {
              max: 4,
            })}
          </>
        )}
        {step === 3 && (
          <>
            {field('activities', pp('pp.edit.activities.label'), pp('pp.edit.activities.hint'), {
              area: true,
            })}
            {planned.length > 0 && (
              <fieldset className="programme-page-confirm">
                <legend>{pp('pp.edit.confirmed.legend')}</legend>
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
            {field('fee', pp('pp.edit.fee.label'), pp('pp.edit.fee.hint'), {
              max: 300,
            })}
            {field('included', pp('pp.edit.included.label'), pp('pp.edit.list.hint'), {
              area: true,
            })}
            {field('excluded', pp('pp.edit.excluded.label'), pp('pp.edit.list.hint'), {
              area: true,
            })}
          </>
        )}
        {step === 5 && (
          <>
            {field('closes', pp('pp.edit.closes.label'), pp('pp.edit.closes.hint'), {
              type: 'date',
            })}
            <details className="programme-page-preview" open>
              <summary>{pp('pp.edit.preview')}</summary>
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
              {pp('pp.edit.agree')}
            </label>
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="guide-actions-row">
          <button type="submit" className="primary-link" disabled={busy}>
            {step === steps.length - 1
              ? busy
                ? pp('pp.edit.publishing')
                : pp('pp.edit.publish')
              : pp('pp.edit.continue')}
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
              {pp('pp.edit.back')}
            </button>
          )}
          <button type="button" className="text-link" onClick={stopEditing}>
            {pp('pp.edit.close')}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="programme-page-panel">
      <p>
        <strong>{pp('pp.org.label')}</strong> {stateWords[view.state]}
        {view.state === 'OPEN' && view.closesAt
          ? pp('pp.org.until', { date: shortDay(view.closesAt) })
          : ''}
        {view.version > 0 ? pp('pp.org.version', { version: view.version }) : ''}
      </p>
      {view.state === 'NONE' && <p className="programme-note">{pp('pp.org.intro')}</p>}
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
              {pp('pp.share.copy')}
            </button>
            <a
              className="text-link"
              href={`https://wa.me/?text=${encodeURIComponent(`${view.copy?.title ?? ''} ${url}`)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {pp('pp.share.whatsapp')}
            </a>
            <a
              className="text-link"
              href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {pp('pp.share.facebook')}
            </a>
          </div>
          <p role="status" className={copied ? 'programme-note' : 'sr-only'}>
            {copied}
          </p>
        </>
      )}
      <div className="guide-actions-row">
        <button type="button" className="primary-link" onClick={startEditing} disabled={busy}>
          {view.version === 0
            ? pp('pp.org.write')
            : shown
              ? pp('pp.org.edit')
              : pp('pp.org.editAgain')}
        </button>
        {shown && (
          <button
            type="button"
            className="text-link"
            onClick={() => void takeDown()}
            disabled={busy}
          >
            {pp('pp.org.takeDown')}
          </button>
        )}
      </div>
      {view.version > 0 && (
        <section
          aria-label={pp('pp.org.applications.label')}
          className="programme-page-applications"
        >
          <h5>
            {pp('pp.org.applications.count', {
              awaiting: view.awaiting,
              total: view.applications,
            })}
          </h5>
          {applications.length === 0 ? (
            <p className="ux-empty">{pp('pp.org.applications.empty')}</p>
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
                    {pp('pp.org.row.applied', { date: shortDay(item.appliedAt) })}
                    {item.status === 'INVITED' && item.invitationExpiresAt
                      ? pp('pp.org.row.invitationUntil', {
                          date: shortDay(item.invitationExpiresAt),
                        })
                      : ''}
                    {item.note ? pp('pp.org.row.yourNote', { note: item.note }) : ''}
                  </p>
                  {item.status === 'JOINED' && (
                    <p className="programme-note">{pp('pp.org.row.joined')}</p>
                  )}
                  {declining === item.id ? (
                    <div className="programme-page-decline">
                      <label className="field">
                        <span>{pp('pp.org.declineReason')}</span>
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
                          {pp('pp.org.declineConfirm')}
                        </button>
                        <button
                          type="button"
                          className="text-link"
                          onClick={() => {
                            setDeclining(null);
                            setRowError(null);
                          }}
                        >
                          {pp('pp.cancel')}
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
                              ? pp('pp.org.inviteAgain')
                              : pp('pp.org.invite')}
                          </button>
                        )}
                        {['SUBMITTED', 'DECLINED', 'INVITATION_EXPIRED'].includes(item.status) && (
                          <button
                            type="button"
                            className="text-link"
                            disabled={busy}
                            onClick={() => void decide(item, 'WAITLISTED')}
                          >
                            {pp('pp.org.waitlist')}
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
                            {pp('pp.org.decline')}
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
              {pp('pp.org.applications.more')}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
