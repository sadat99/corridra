'use client';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  composeBrief,
  draftCommandId,
  draftProblems,
  draftReadiness,
  missionDraftFamilyLabels,
  missionDraftObjectives,
  requirementPrompts,
  sourcingContextLabels,
  type DraftFormValues,
  type MissionDraftFamily,
  type SourcingContext,
} from '@corridra/domain/mission-drafts';
import { outcomeOptions } from '@corridra/domain/missions';

type Status = 'OPEN' | 'SUBMITTED' | 'DISCARDED';
type ServerDraft = {
  id: string;
  version: number;
  status: Status;
  requestId: string | null;
  updatedAt: string;
  details: DraftFormValues;
};
type View = {
  workspaceId: string;
  expiresAt: string;
  currentVersion: number;
  superseded: boolean;
  commandId?: string;
  draft: ServerDraft;
};
type Row = {
  id: string;
  version: number;
  title: string;
  family: MissionDraftFamily;
  status: Status;
  requestId: string | null;
  updatedAt: string;
};
type ListPage = { workspaceId: string; expiresAt: string; drafts: Row[]; nextAfter: string | null };
type Scope = { subject: string; issuer: string; workspaceId: string; profilesEnabled: boolean };

const steps = [
  'What you want',
  'Where and when',
  'What you offer or need',
  'About you',
  'Review and send',
];
const familyHelp: Record<MissionDraftFamily, string> = {
  BUYERS_PARTNERS:
    'You sell, distribute or want to enter a market. For example, buyer meetings around a trade fair.',
  SUPPLIERS_PRODUCTS:
    'You buy or source. For example, qualified manufacturers for a product or a machine.',
  DELEGATION:
    'You organise or take part in a group business visit. Programme setup stays in the delegation planner.',
  OTHER:
    'Something that fits none of the above, such as a market-entry check or a special project.',
};
const familyShort: Record<MissionDraftFamily, string> = {
  BUYERS_PARTNERS: 'buyer search',
  SUPPLIERS_PRODUCTS: 'supplier search',
  DELEGATION: 'delegation',
  OTHER: 'business',
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const stamp = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const clock = (v: string) =>
  new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(v)) + ' UTC';

function blank(family: MissionDraftFamily): DraftFormValues {
  let timezone = 'UTC';
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    /* A fixed fallback keeps the form usable when the browser hides its time zone. */
  }
  return {
    title: `${realCustomerInput() ? '' : 'Synthetic '}${familyShort[family]} request`,
    family,
    objective: missionDraftObjectives[family][0] ?? null,
    market: '',
    attendance: 'Not decided',
    startDate: '',
    endDate: '',
    timezone,
    offer: '',
    website: '',
    outcomes: [],
    notes: '',
    requirements: [],
    contactName: '',
    contactEmail: '',
    companyName: '',
    profileVersion: null,
    sourcingContext: null,
  };
}
function parseView(value: unknown, scope: Scope): View {
  const v = value as View;
  if (
    !v ||
    v.workspaceId !== scope.workspaceId ||
    !stamp(v.expiresAt) ||
    !v.draft ||
    typeof v.draft.id !== 'string' ||
    !uuid.test(v.draft.id) ||
    !Number.isInteger(v.draft.version) ||
    v.draft.version < 1 ||
    !['OPEN', 'SUBMITTED', 'DISCARDED'].includes(v.draft.status) ||
    !v.draft.details ||
    typeof v.draft.details.title !== 'string' ||
    !(v.draft.details.family in missionDraftFamilyLabels) ||
    !Array.isArray(v.draft.details.requirements) ||
    !Array.isArray(v.draft.details.outcomes)
  )
    throw new Error('Invalid draft');
  return v;
}
function parseList(value: unknown, scope: Scope): ListPage {
  const v = value as ListPage;
  if (
    !v ||
    v.workspaceId !== scope.workspaceId ||
    !stamp(v.expiresAt) ||
    !Array.isArray(v.drafts) ||
    !v.drafts.every(
      (d) =>
        d &&
        typeof d.id === 'string' &&
        uuid.test(d.id) &&
        typeof d.title === 'string' &&
        d.family in missionDraftFamilyLabels &&
        ['OPEN', 'SUBMITTED', 'DISCARDED'].includes(d.status) &&
        stamp(d.updatedAt),
    )
  )
    throw new Error('Invalid list');
  return v;
}

export function GuidedRequest(props: Scope) {
  return (
    <Guided key={JSON.stringify([props.issuer, props.subject, props.workspaceId])} {...props} />
  );
}

function Guided(scope: Scope) {
  const id = useId();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [nextAfter, setNextAfter] = useState<string | null>(null);
  const [form, setForm] = useState<DraftFormValues | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [closed, setClosed] = useState<Status | null>(null);
  const [step, setStep] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [message, setMessage] = useState('Loading your drafts…');
  const [ack, setAck] = useState(false);
  const active = useRef(false);
  const flight = useRef(false);
  const task = useRef<AbortController | null>(null);
  const pendingSave = useRef<{ signature: string; commandId: string } | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);

  const headers = useCallback(
    (json = false): Record<string, string> => ({
      'x-corridra-customer-subject': scope.subject,
      'x-corridra-customer-issuer': scope.issuer,
      ...(json ? { 'content-type': 'application/json' } : {}),
    }),
    [scope.subject, scope.issuer],
  );
  const reset = useCallback((why: string) => {
    task.current?.abort();
    flight.current = false;
    setBusy(false);
    setRows(null);
    setNextAfter(null);
    setForm(null);
    setDraftId(null);
    setVersion(0);
    setClosed(null);
    setDirty(false);
    setConflict(false);
    setSent(null);
    setAck(false);
    pendingSave.current = null;
    setMessage(why);
  }, []);
  // 401/403 means access ended, so private text is cleared. 409 keeps the customer's own unsaved text.
  const denied = useCallback(
    (status: number) => {
      if (status === 401 || status === 403) {
        reset('Access to this workspace changed. Local details were cleared.');
        return true;
      }
      if (status === 503) {
        reset(
          realCustomerInput()
            ? 'Request drafts are unavailable.'
            : 'Sample request drafts are unavailable.',
        );
        return true;
      }
      return false;
    },
    [reset],
  );
  const loadList = useCallback(
    async (after?: string) => {
      task.current?.abort();
      const controller = new AbortController();
      task.current = controller;
      try {
        const q = new URLSearchParams({
          workspaceId: scope.workspaceId,
          ...(after ? { after } : {}),
        });
        const r = await fetch('/api/customer-mission-drafts?' + q, {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: headers(),
          signal: controller.signal,
        });
        if (!active.current || controller.signal.aborted) return;
        if (denied(r.status)) return;
        if (r.status === 409) {
          reset('Your account changed. Reload this page to continue.');
          return;
        }
        if (!r.ok) throw new Error('failed');
        const page = parseList(await r.json(), scope);
        setRows((old) => (after && old ? [...old, ...page.drafts] : page.drafts));
        setNextAfter(page.nextAfter);
        setMessage(page.drafts.length ? '' : 'You have no saved drafts yet.');
      } catch {
        if (active.current && !controller.signal.aborted)
          setMessage('Your drafts could not be loaded. Try again.');
      }
    },
    [scope, headers, denied, reset],
  );
  useEffect(() => {
    active.current = true;
    void Promise.resolve().then(() => {
      if (active.current) void loadList();
    });
    return () => {
      active.current = false;
      task.current?.abort();
    };
  }, [loadList]);
  useEffect(() => {
    if (!dirty) return;
    const leave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [dirty]);
  const noForm = form === null;
  useEffect(() => {
    heading.current?.focus();
  }, [step, noForm]);

  const set = <K extends keyof DraftFormValues>(key: K, value: DraftFormValues[K]) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setDirty(true);
  };
  const startNew = (family: MissionDraftFamily) => {
    setForm(blank(family));
    setDraftId(null);
    setVersion(0);
    setClosed(null);
    setStep(1);
    setDirty(true);
    setSent(null);
    setConflict(false);
    setMessage('');
  };
  const open = async (row: Row) => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    try {
      const r = await fetch(
        '/api/customer-mission-drafts?' +
          new URLSearchParams({ workspaceId: scope.workspaceId, draftId: row.id }),
        { cache: 'no-store', credentials: 'same-origin', headers: headers() },
      );
      if (!active.current) return;
      if (denied(r.status)) return;
      if (!r.ok) throw new Error('failed');
      const v = parseView(await r.json(), scope);
      setForm(v.draft.details);
      setDraftId(v.draft.id);
      setVersion(v.draft.version);
      setClosed(v.draft.status === 'OPEN' ? null : v.draft.status);
      setStep(v.draft.status === 'OPEN' ? 1 : 4);
      setDirty(false);
      setConflict(false);
      setMessage('');
    } catch {
      if (active.current) setMessage('That draft could not be opened. Try again.');
    } finally {
      flight.current = false;
      if (active.current) setBusy(false);
    }
  };
  // Saving writes a new version. An unchanged retry reuses its command id so it can never double-save.
  const persist = async (): Promise<{ id: string; version: number } | null> => {
    if (!form) return null;
    const problems = draftProblems(form);
    if (problems.length) {
      setMessage('Fix the highlighted details before saving.');
      return null;
    }
    const signature = JSON.stringify([draftId, version, form]);
    if (pendingSave.current?.signature !== signature)
      pendingSave.current = { signature, commandId: crypto.randomUUID() };
    const r = await fetch('/api/customer-mission-drafts', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: headers(true),
      body: JSON.stringify({
        action: 'save',
        input: {
          commandId: pendingSave.current.commandId,
          workspaceId: scope.workspaceId,
          draftId,
          expectedVersion: version,
          details: form,
          acknowledged: true,
        },
      }),
    });
    if (!active.current) return null;
    if (denied(r.status)) return null;
    if (r.status === 409) {
      setConflict(true);
      setMessage(
        'This draft changed somewhere else, or your account changed. Your text below is kept. Reload the latest draft before saving again.',
      );
      return null;
    }
    if (r.status === 400) {
      setMessage('Check the highlighted details, then save again.');
      return null;
    }
    if (!r.ok) throw new Error('failed');
    const v = parseView(await r.json(), scope);
    if (v.commandId !== pendingSave.current.commandId) throw new Error('mismatch');
    setDraftId(v.draft.id);
    setVersion(v.draft.version);
    setDirty(false);
    pendingSave.current = null;
    return { id: v.draft.id, version: v.draft.version };
  };
  const save = async () => {
    if (flight.current || !form) return;
    flight.current = true;
    setBusy(true);
    try {
      const saved = await persist();
      if (saved && active.current) setMessage('Draft saved. You can come back to it any time.');
    } catch {
      if (active.current)
        setMessage('Saving could not be confirmed. Your text is kept. Try again.');
    } finally {
      flight.current = false;
      if (active.current) setBusy(false);
    }
  };
  const reload = async () => {
    if (!draftId) {
      reset('Loading your drafts…');
      void loadList();
      return;
    }
    if (dirty && !window.confirm('Discard your unsaved changes and load the latest saved draft?'))
      return;
    await open({ id: draftId } as Row);
  };
  const discard = async () => {
    if (flight.current || !draftId || !window.confirm('Discard this draft? It cannot be reopened.'))
      return;
    flight.current = true;
    setBusy(true);
    try {
      const r = await fetch('/api/customer-mission-drafts', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: headers(true),
        body: JSON.stringify({
          action: 'close',
          input: {
            commandId: await draftCommandId('discard', draftId, version),
            workspaceId: scope.workspaceId,
            draftId,
            outcome: 'DISCARDED',
            requestId: null,
          },
        }),
      });
      if (denied(r.status)) return;
      if (!r.ok) throw new Error('failed');
      setClosed('DISCARDED');
      setDirty(false);
      setMessage('Draft discarded.');
    } catch {
      setMessage('The draft could not be discarded. Try again.');
    } finally {
      flight.current = false;
      if (active.current) setBusy(false);
    }
  };
  // Sending reuses the existing private request. The command id comes from the draft and its saved
  // version, so repeating the step returns the original request instead of creating a second one.
  const send = async () => {
    if (flight.current || !form || !ack) return;
    const brief = composeBrief(form);
    if (!brief) {
      setMessage('Complete the missing details before sending.');
      return;
    }
    flight.current = true;
    setBusy(true);
    try {
      const saved = dirty || !draftId ? await persist() : { id: draftId, version };
      if (!saved) return;
      const r = await fetch('/api/customer-requests', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: headers(true),
        body: JSON.stringify({
          commandId: await draftCommandId('send', saved.id, saved.version),
          workspaceId: scope.workspaceId,
          brief,
        }),
      });
      if (!active.current) return;
      if (denied(r.status)) return;
      if (r.status === 409) {
        setConflict(true);
        setMessage('Your account or this request changed. Reload before sending.');
        return;
      }
      if (!r.ok) throw new Error(r.status === 429 ? 'limit' : 'failed');
      const ack = (await r.json()) as { id?: unknown; workspaceId?: unknown };
      if (typeof ack.id !== 'string' || !uuid.test(ack.id) || ack.workspaceId !== scope.workspaceId)
        throw new Error('mismatch');
      const c = await fetch('/api/customer-mission-drafts', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: headers(true),
        body: JSON.stringify({
          action: 'close',
          input: {
            commandId: await draftCommandId('close', saved.id, saved.version),
            workspaceId: scope.workspaceId,
            draftId: saved.id,
            outcome: 'SUBMITTED',
            requestId: ack.id,
          },
        }),
      });
      if (!c.ok) {
        setMessage(
          'Your request was sent, but this draft could not be marked as sent. Press Send again to finish.',
        );
        return;
      }
      setSent(ack.id);
      setClosed('SUBMITTED');
      setMessage('');
    } catch (e) {
      if (active.current)
        setMessage(
          e instanceof Error && e.message === 'limit'
            ? 'The request limit was reached. Try again later.'
            : 'Sending could not be confirmed. Your draft is kept. Press Send again to retry safely.',
        );
    } finally {
      flight.current = false;
      if (active.current) setBusy(false);
    }
  };
  const fillFromProfile = async () => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    try {
      const r = await fetch(
        '/api/customer-organisation-profiles?' +
          new URLSearchParams({ workspaceId: scope.workspaceId }),
        { cache: 'no-store', credentials: 'same-origin', headers: headers() },
      );
      if (denied(r.status)) return;
      if (!r.ok) throw new Error('failed');
      const v = (await r.json()) as {
        workspaceId?: string;
        verified?: boolean;
        profile: null | { legalName: string; website: string | null; version: number };
      };
      if (v.workspaceId !== scope.workspaceId || v.verified !== false) throw new Error('mismatch');
      if (!v.profile) {
        setMessage('You have not saved a company profile yet. You can type the details instead.');
        return;
      }
      setForm((f) =>
        f
          ? {
              ...f,
              companyName: v.profile!.legalName,
              website: f.website || v.profile!.website || '',
              profileVersion: v.profile!.version,
            }
          : f,
      );
      setDirty(true);
      setMessage(
        `Filled from your saved company profile (version ${v.profile.version}). Change anything you like.`,
      );
    } catch {
      setMessage('Your company profile could not be loaded. You can type the details instead.');
    } finally {
      flight.current = false;
      if (active.current) setBusy(false);
    }
  };

  // ---------- rendering ----------
  if (sent)
    return (
      <section aria-label="Request sent">
        <h2 ref={heading} tabIndex={-1}>
          Your request was sent.
        </h2>
        <p>
          This is a request, not an accepted engagement. Nothing is confirmed or scheduled yet.
          Corridra staff can reply with questions. You will see replies and status under your saved
          requests.
        </p>
        <p>
          <a className="text-link" href="/account#customer-requests">
            See your saved requests
          </a>
        </p>
        <p>
          <button
            type="button"
            className="text-link ux-back"
            onClick={() => reset('Loading your drafts…') ?? void loadList()}
          >
            Back to your drafts
          </button>
        </p>
      </section>
    );

  if (!form)
    return (
      <section aria-label="Guided request drafts">
        <p>
          {realCustomerInput()
            ? 'Enter a clear description with at least two characters.'
            : 'Start a request in a few questions, save it and come back later. Everything you enter is self-declared and unverified. This is test mode: start your text with the word Synthetic.'}{' '}
        </p>
        <p role="status">{message}</p>
        <h2 ref={heading} tabIndex={-1}>
          What do you want to do?
        </h2>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {(Object.keys(missionDraftFamilyLabels) as MissionDraftFamily[]).map((family) => (
            <li key={family} style={{ marginBlock: '0.75rem' }}>
              <button
                type="button"
                className="button button-primary"
                disabled={busy}
                onClick={() => startNew(family)}
              >
                {missionDraftFamilyLabels[family]}
              </button>
              <p style={{ margin: '0.25rem 0 0' }}>{familyHelp[family]}</p>
            </li>
          ))}
        </ul>
        {rows && rows.length > 0 && (
          <section aria-label="Your drafts">
            <h2>Your drafts</h2>
            <ul>
              {rows.map((row) => (
                <li key={row.id}>
                  <strong>{row.title}</strong> ·{' '}
                  {row.status === 'OPEN'
                    ? 'In progress'
                    : row.status === 'SUBMITTED'
                      ? 'Sent as a request'
                      : 'Discarded'}{' '}
                  · {missionDraftFamilyLabels[row.family]} · saved {clock(row.updatedAt)}{' '}
                  <button
                    type="button"
                    className="text-link"
                    disabled={busy}
                    onClick={() => void open(row)}
                  >
                    {row.status === 'OPEN' ? 'Continue ' : 'View '}
                    {row.title}
                  </button>
                </li>
              ))}
            </ul>
            {nextAfter && (
              <button type="button" className="text-link" onClick={() => void loadList(nextAfter)}>
                Load more drafts
              </button>
            )}
          </section>
        )}
        <p>
          <a className="text-link" href={'/account/request/' + scope.workspaceId}>
            Use the single-page request form instead
          </a>
        </p>
      </section>
    );

  const problems = draftProblems(form);
  const problem = (field: string) => problems.find((p) => p.field === field)?.message;
  const readiness = draftReadiness(form);
  const locked = closed !== null;
  const prompts = requirementPrompts(form.family, form.sourcingContext).filter(
    (p) => !form.requirements.some((r) => r.label.toLowerCase() === p.toLowerCase()),
  );
  const field = (name: string, label: string, control: React.ReactNode, hint?: string) => (
    <div style={{ marginBlock: '0.75rem' }}>
      <label htmlFor={id + name}>{label}</label>
      {hint && (
        <p id={id + name + 'hint'} style={{ margin: '0.25rem 0' }}>
          {hint}
        </p>
      )}
      {control}
      {problem(name) && (
        <p id={id + name + 'err'} role="alert">
          {problem(name)}
        </p>
      )}
    </div>
  );
  const common = (name: string) => ({
    id: id + name,
    'aria-invalid': problem(name) ? (true as const) : undefined,
    'aria-describedby':
      [problem(name) ? id + name + 'err' : '', id + name + 'hint'].filter(Boolean).join(' ') ||
      undefined,
    disabled: busy || locked,
  });

  return (
    <section aria-label="Guided request">
      <p role="status">{message}</p>
      {locked && (
        <p role="status">
          {closed === 'SUBMITTED'
            ? 'This draft was sent as a request and is now read-only.'
            : 'This draft was discarded and is now read-only.'}
        </p>
      )}
      {conflict && (
        <p>
          <button type="button" className="button" disabled={busy} onClick={() => void reload()}>
            Reload the latest draft
          </button>
        </p>
      )}
      <ol
        aria-label="Steps"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', listStyle: 'none', padding: 0 }}
      >
        {steps.map((name, i) => (
          <li key={name}>
            <button
              type="button"
              className="text-link"
              aria-current={i === step ? 'step' : undefined}
              disabled={busy}
              onClick={() => setStep(i)}
            >
              {i + 1}. {name}
            </button>
          </li>
        ))}
      </ol>
      <h2 ref={heading} tabIndex={-1}>
        {steps[step]}
      </h2>
      <p>Request type: {missionDraftFamilyLabels[form.family]}</p>

      {step === 0 && (
        <fieldset disabled={busy || locked}>
          <legend>Choose what you want to do</legend>
          {(Object.keys(missionDraftFamilyLabels) as MissionDraftFamily[]).map((family) => (
            <label key={family} style={{ display: 'block', marginBlock: '0.5rem' }}>
              <input
                type="radio"
                name={id + 'family'}
                checked={form.family === family}
                onChange={() => {
                  setForm((f) =>
                    f
                      ? {
                          ...f,
                          family,
                          objective:
                            missionDraftObjectives[family].includes(f.objective as never) ||
                            f.objective === 'Something else'
                              ? f.objective
                              : (missionDraftObjectives[family][0] ?? null),
                          sourcingContext:
                            family === 'SUPPLIERS_PRODUCTS' ? f.sourcingContext : null,
                        }
                      : f,
                  );
                  setDirty(true);
                }}
              />{' '}
              {missionDraftFamilyLabels[family]}
              <span style={{ display: 'block' }}>{familyHelp[family]}</span>
            </label>
          ))}
          {field(
            'title',
            realCustomerInput() ? 'Name this request' : 'Name this request (start with Synthetic)',
            <input
              {...common('title')}
              value={form.title}
              maxLength={120}
              onChange={(e) => set('title', e.target.value)}
            />,
          )}
        </fieldset>
      )}

      {step === 1 && (
        <fieldset disabled={busy || locked}>
          <legend>Where and when</legend>
          {field(
            'objective',
            'What is your main aim?',
            <select
              {...common('objective')}
              value={form.objective ?? ''}
              onChange={(e) =>
                set('objective', (e.target.value || null) as DraftFormValues['objective'])
              }
            >
              <option value="">Choose an aim</option>
              {[
                ...new Set([...missionDraftObjectives[form.family], 'Something else' as const]),
              ].map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>,
          )}
          {field(
            'market',
            'Target country or market',
            <input
              {...common('market')}
              value={form.market}
              maxLength={120}
              placeholder="Spain"
              onChange={(e) => set('market', e.target.value)}
            />,
          )}
          <fieldset>
            <legend>Will you travel there in person?</legend>
            {(['Yes', 'No', 'Not decided'] as const).map((value) => (
              <label key={value} style={{ display: 'inline-block', marginRight: '1rem' }}>
                <input
                  type="radio"
                  name={id + 'attendance'}
                  checked={form.attendance === value}
                  onChange={() => {
                    setForm((f) =>
                      f
                        ? {
                            ...f,
                            attendance: value,
                            ...(value === 'Yes' ? {} : { startDate: '', endDate: '' }),
                          }
                        : f,
                    );
                    setDirty(true);
                  }}
                />{' '}
                {value}
              </label>
            ))}
          </fieldset>
          {form.attendance === 'Yes' && (
            <>
              {field(
                'startDate',
                'Visit start date',
                <input
                  {...common('startDate')}
                  type="date"
                  value={form.startDate}
                  onChange={(e) => set('startDate', e.target.value)}
                />,
              )}
              {field(
                'endDate',
                'Visit end date',
                <input
                  {...common('endDate')}
                  type="date"
                  value={form.endDate}
                  onChange={(e) => set('endDate', e.target.value)}
                />,
              )}
              {field(
                'timezone',
                'Time zone',
                <input
                  {...common('timezone')}
                  value={form.timezone}
                  maxLength={80}
                  onChange={(e) => set('timezone', e.target.value)}
                />,
              )}
            </>
          )}
        </fieldset>
      )}

      {step === 2 && (
        <fieldset disabled={busy || locked}>
          <legend>What you offer or need</legend>
          {field(
            'offer',
            form.family === 'SUPPLIERS_PRODUCTS'
              ? realCustomerInput()
                ? 'What do you need to buy?'
                : 'What do you need to buy? (start with Synthetic)'
              : realCustomerInput()
                ? 'What do you offer or need?'
                : 'What do you offer or need? (start with Synthetic)',
            <textarea
              {...common('offer')}
              rows={4}
              maxLength={2000}
              value={form.offer}
              onChange={(e) => set('offer', e.target.value)}
            />,
          )}
          {form.family === 'SUPPLIERS_PRODUCTS' &&
            field(
              'sourcingContext',
              'What kind of purchase is this?',
              <select
                {...common('sourcingContext')}
                value={form.sourcingContext ?? ''}
                onChange={(e) =>
                  set('sourcingContext', (e.target.value || null) as SourcingContext | null)
                }
              >
                <option value="">Not sure yet</option>
                {(Object.keys(sourcingContextLabels) as SourcingContext[]).map((c) => (
                  <option key={c} value={c}>
                    {sourcingContextLabels[c]}
                  </option>
                ))}
              </select>,
              form.sourcingContext === 'OTHER_PROCUREMENT'
                ? 'Suggested questions for other purchases are not available yet. Add your own lines below.'
                : 'Your answer decides which suggested questions you see.',
            )}
          <section aria-label="Requirements">
            <h3>Requirements (optional)</h3>
            {form.requirements.map((r, i) => (
              <div key={i} style={{ marginBlock: '0.5rem' }}>
                <label htmlFor={id + 'rl' + i}>Requirement {i + 1} label</label>
                <input
                  id={id + 'rl' + i}
                  value={r.label}
                  maxLength={60}
                  disabled={busy || locked}
                  aria-invalid={problem('requirements.' + i + '.label') ? true : undefined}
                  onChange={(e) =>
                    set(
                      'requirements',
                      form.requirements.map((x, j) =>
                        j === i ? { ...x, label: e.target.value } : x,
                      ),
                    )
                  }
                />
                <label htmlFor={id + 'rv' + i}>
                  Requirement {i + 1}{' '}
                  {realCustomerInput() ? 'detail' : 'detail (start with Synthetic)'}{' '}
                </label>
                <input
                  id={id + 'rv' + i}
                  value={r.value}
                  maxLength={300}
                  disabled={busy || locked}
                  aria-invalid={problem('requirements.' + i + '.value') ? true : undefined}
                  onChange={(e) =>
                    set(
                      'requirements',
                      form.requirements.map((x, j) =>
                        j === i ? { ...x, value: e.target.value } : x,
                      ),
                    )
                  }
                />
                {(problem('requirements.' + i + '.label') ||
                  problem('requirements.' + i + '.value')) && (
                  <p role="alert">
                    {problem('requirements.' + i + '.label') ??
                      problem('requirements.' + i + '.value')}
                  </p>
                )}
                <button
                  type="button"
                  className="text-link"
                  disabled={busy || locked}
                  onClick={() =>
                    set(
                      'requirements',
                      form.requirements.filter((_, j) => j !== i),
                    )
                  }
                >
                  Remove requirement {i + 1}
                </button>
              </div>
            ))}
            {form.requirements.length < 20 && (
              <>
                {prompts.length > 0 && <p>Add a suggested question:</p>}
                <ul
                  style={{
                    listStyle: 'none',
                    padding: 0,
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '0.5rem',
                  }}
                >
                  {prompts.map((p) => (
                    <li key={p}>
                      <button
                        type="button"
                        className="button"
                        disabled={busy || locked}
                        onClick={() =>
                          set('requirements', [
                            ...form.requirements,
                            { label: p, value: realCustomerInput() ? '' : 'Synthetic ' },
                          ])
                        }
                      >
                        Add {p}
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="text-link"
                  disabled={busy || locked}
                  onClick={() =>
                    set('requirements', [
                      ...form.requirements,
                      { label: '', value: realCustomerInput() ? '' : 'Synthetic ' },
                    ])
                  }
                >
                  Add my own line
                </button>
              </>
            )}
          </section>
          <fieldset>
            <legend>What would you like from this?</legend>
            {outcomeOptions.map((o) => (
              <label key={o}>
                <input
                  type="checkbox"
                  checked={form.outcomes.includes(o)}
                  onChange={(e) =>
                    set(
                      'outcomes',
                      e.target.checked
                        ? [...form.outcomes, o]
                        : form.outcomes.filter((x) => x !== o),
                    )
                  }
                />{' '}
                {o}
              </label>
            ))}
          </fieldset>
          {field(
            'notes',
            realCustomerInput()
              ? 'Anything else? (optional)'
              : 'Anything else? (optional, start with Synthetic)',
            <textarea
              {...common('notes')}
              rows={2}
              maxLength={1000}
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
            />,
          )}
        </fieldset>
      )}

      {step === 3 && (
        <fieldset disabled={busy || locked}>
          <legend>About you</legend>
          <p>
            You only need a company name to send a request. A saved company profile is optional.
          </p>
          {scope.profilesEnabled && !locked && (
            <p>
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => void fillFromProfile()}
              >
                Use my saved company profile
              </button>
            </p>
          )}
          {field(
            'companyName',
            realCustomerInput() ? 'Company name' : 'Company name (start with Synthetic)',
            <input
              {...common('companyName')}
              value={form.companyName}
              maxLength={160}
              onChange={(e) => set('companyName', e.target.value)}
            />,
          )}
          {field(
            'website',
            'Website (optional)',
            <input
              {...common('website')}
              value={form.website}
              maxLength={200}
              placeholder="https://company.example"
              onChange={(e) => set('website', e.target.value)}
            />,
          )}
          {field(
            'contactName',
            'Your name',
            <input
              {...common('contactName')}
              value={form.contactName}
              maxLength={120}
              onChange={(e) => set('contactName', e.target.value)}
            />,
          )}
          {field(
            'contactEmail',
            'Test email address',
            <input
              {...common('contactEmail')}
              type="email"
              value={form.contactEmail}
              maxLength={254}
              placeholder="name@example.invalid"
              onChange={(e) => set('contactEmail', e.target.value.toLowerCase())}
            />,
            'Used only so staff can reply to this request.',
          )}
        </fieldset>
      )}

      {step === 4 && (
        <section aria-label="Review">
          <dl>
            <dt>Request</dt>
            <dd>{form.title}</dd>
            <dt>Aim</dt>
            <dd>{form.objective ?? 'Not chosen yet'}</dd>
            <dt>Market</dt>
            <dd>{form.market || 'Not entered yet'}</dd>
            <dt>Offer or need</dt>
            <dd>{form.offer || 'Not entered yet'}</dd>
            {form.sourcingContext && (
              <>
                <dt>Kind of purchase</dt>
                <dd>{sourcingContextLabels[form.sourcingContext]}</dd>
              </>
            )}
            <dt>Requirements</dt>
            <dd>
              {form.requirements.length
                ? form.requirements.map((r) => `${r.label}: ${r.value}`).join('; ')
                : 'None added'}
            </dd>
            <dt>Company</dt>
            <dd>{form.companyName || 'Not entered yet'}</dd>
          </dl>
          {!readiness.ready && (
            <div role="alert">
              <p>To send this request you still need:</p>
              <ul>
                {readiness.gaps.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
              <p>You can save the draft now and finish later.</p>
            </div>
          )}
          <h3>What happens next</h3>
          <p>
            Sending creates a private request in this test workspace. A request is not an accepted
            engagement, and nothing is confirmed, scheduled or promised by sending. Corridra staff
            may reply with questions. Everything you entered is self-declared and unverified.
          </p>
          <p>
            Your next useful result is a reviewed reply to this request, shown under your saved
            requests.
          </p>
          {!locked && (
            <label style={{ display: 'flex', gap: '0.75rem', marginBlock: '1rem' }}>
              <input
                type="checkbox"
                checked={ack}
                disabled={busy}
                onChange={(e) => setAck(e.target.checked)}
              />
              {realCustomerInput()
                ? 'I confirm these request details are accurate to the best of my knowledge.'
                : 'I confirm these are fictional test details.'}{' '}
            </label>
          )}
          {!locked && (
            <button
              type="button"
              className="button button-primary"
              disabled={busy || !ack || !readiness.ready || problems.length > 0 || conflict}
              onClick={() => void send()}
            >
              {busy ? 'Working…' : 'Send request'}
            </button>
          )}
        </section>
      )}

      <div style={{ marginBlock: '1rem', display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
        {step > 0 && (
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => setStep(step - 1)}
          >
            Back
          </button>
        )}
        {step < 4 && (
          <button
            type="button"
            className="button button-primary"
            disabled={busy}
            onClick={() => setStep(step + 1)}
          >
            Next
          </button>
        )}
        {!locked && (
          <button
            type="button"
            className="button"
            disabled={busy || conflict || (!dirty && draftId !== null)}
            onClick={() => void save()}
          >
            Save draft
          </button>
        )}
        {!locked && draftId && (
          <button
            data-intent="destructive"
            type="button"
            className="text-link"
            disabled={busy}
            onClick={() => void discard()}
          >
            Discard this draft
          </button>
        )}
        <button
          type="button"
          className="text-link ux-back"
          disabled={busy}
          onClick={() => {
            if (
              dirty &&
              !window.confirm('Leave without saving? Your unsaved changes will be lost.')
            )
              return;
            setForm(null);
            setDraftId(null);
            setDirty(false);
            setConflict(false);
            void loadList();
          }}
        >
          Back to your drafts
        </button>
      </div>
      {dirty && !locked && <p>You have unsaved changes.</p>}
    </section>
  );
}
