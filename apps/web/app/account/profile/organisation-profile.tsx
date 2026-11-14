'use client';
import '../page-budget.css';
import './profile-steps.css';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import { Fragment, useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { CountrySelect } from '../../../components/ux/pickers';
import { countryName } from '../../../lib/ux/options';
import { onDeviceClock, privateViewMaxMs } from '../../../lib/server-clock';
import { ReplyError, loadReason, withReason } from '../../../lib/load-reason';
import { profileHelper } from '../frame-copy';
const roleOptions = [
  ['BUYER', 'Buyer'],
  ['SELLER', 'Seller'],
  ['SUPPLIER', 'Supplier'],
  ['MANUFACTURER', 'Manufacturer'],
  ['DISTRIBUTOR', 'Distributor'],
  ['ORGANISER', 'Delegation organiser'],
] as const;
const sizeOptions = ['1-10', '11-50', '51-200', '201-1000', '1000+'] as const;
// The three steps of the form when `steps` is on (UI/UX.v3: one to three controls a step). Presentation only: every
// control stays in the one form and the one fieldset, in the same order, with the same ids, names and payload.
const stepNames = ['Company', 'Profile', 'Confirm'] as const;
const lastStep = stepNames.length - 1;
type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
function Step({
  n,
  on,
  shown,
  children,
}: {
  n: number;
  on: boolean;
  shown: number;
  children: ReactNode;
}) {
  if (!on) return <Fragment>{children}</Fragment>;
  return (
    <div className="profile-step" data-step={n} hidden={shown !== n}>
      {children}
    </div>
  );
}
/** The first control that fails its own rules (required, length) in steps `from` to `to`, with the step it is in. */
function firstInvalid(form: HTMLFormElement, from: number, to: number) {
  for (let n = from; n <= to; n++) {
    const box = form.querySelector(`[data-step="${n}"]`);
    const bad = Array.from(box?.querySelectorAll<Field>('input, select, textarea') ?? []).find(
      (field) => !field.checkValidity(),
    );
    if (bad) return { field: bad, n };
  }
  return null;
}
type Details = {
  legalName: string;
  countryCode: string;
  website: string | null;
  commercialRoles: string[];
  sectors: string[];
  sizeBand: string;
  summary: string;
};
type Profile = Details & { version: number; updatedAt: string; reason?: string };
type View = {
  workspaceId: string;
  expiresAt: string;
  organisationId: null;
  canonicalLinked: false;
  provenance: 'SELF_REPORTED';
  verified: false;
  canEdit: boolean;
  currentVersion: number;
  commandId?: string;
  profile: Profile | null;
};
type Revision = { version: number; reason: string; createdAt: string; byYou: boolean };
type Draft = {
  legalName: string;
  countryCode: string;
  website: string;
  commercialRoles: string[];
  sectors: string;
  sizeBand: string;
  summary: string;
  reason: string;
};
const empty: Draft = {
  legalName: '',
  countryCode: '',
  website: '',
  commercialRoles: [],
  sectors: '',
  sizeBand: '',
  summary: '',
  reason: '',
};
function parseView(value: unknown, workspaceId: string): View {
  const v = value as View;
  if (!v || typeof v !== 'object') throw new ReplyError('reply empty');
  const expires = Date.parse(v.expiresAt);
  const checks: [string, boolean][] = [
    ['workspace', v.workspaceId !== workspaceId],
    ['organisation', v.organisationId !== null],
    ['canonical', v.canonicalLinked !== false],
    ['provenance', v.provenance !== 'SELF_REPORTED'],
    ['verified', v.verified !== false],
    ['can edit', typeof v.canEdit !== 'boolean'],
    ['version', !Number.isInteger(v.currentVersion) || v.currentVersion < 0],
    ['expiry missing', !Number.isFinite(expires)],
    ['expiry past', expires <= Date.now()],
    ['expiry far', expires > Date.now() + privateViewMaxMs],
  ];
  const failed = checks.find(([, bad]) => bad);
  if (failed) throw new ReplyError(`reply ${failed[0]}`);
  if (v.profile !== null) {
    const p = v.profile;
    const fields: [string, boolean][] = [
      ['profile', !p || typeof p !== 'object'],
      ['profile version', p?.version !== v.currentVersion],
      ['legal name', typeof p?.legalName !== 'string'],
      ['country', typeof p?.countryCode !== 'string'],
      ['summary', typeof p?.summary !== 'string'],
      ['size', typeof p?.sizeBand !== 'string'],
      ['website', !(p?.website === null || typeof p?.website === 'string')],
      ['roles', !Array.isArray(p?.commercialRoles)],
      ['sectors', !Array.isArray(p?.sectors)],
    ];
    const bad = fields.find(([, wrong]) => wrong);
    if (bad) throw new ReplyError(`reply ${bad[0]}`);
  } else if (v.currentVersion !== 0) throw new ReplyError('reply profile missing');
  return v;
}
function toDraft(p: Profile | null): Draft {
  return p
    ? {
        legalName: p.legalName,
        countryCode: p.countryCode,
        website: p.website ?? '',
        commercialRoles: p.commercialRoles,
        sectors: p.sectors.join(', '),
        sizeBand: p.sizeBand,
        summary: p.summary,
        reason: '',
      }
    : empty;
}
export function OrganisationProfile(props: {
  subject: string;
  issuer: string;
  workspaceId: string;
  /** Ask for the details in three steps of one to three controls. Off, the form is the single form it always was. */
  steps?: boolean;
  /** The page frame shows the back link and the helper line; this section leaves them out. */
  framed?: boolean;
}) {
  const { subject, issuer, workspaceId, steps = false, framed = false } = props;
  const id = useId(),
    [view, setView] = useState<View | null>(null),
    [history, setHistory] = useState<Revision[] | null>(null),
    [draft, setDraft] = useState<Draft>(empty),
    [ack, setAck] = useState(false),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(
      realCustomerInput()
        ? 'Loading your company profile…'
        : 'Loading your sample company profile…',
    ),
    [pending, setPending] = useState<Record<string, unknown> | null>(null),
    // The edit form opens only when asked (one form at a time); a first profile has no summary, so it starts open.
    [editing, setEditing] = useState(false),
    // Steps only: the step shown, and the sentence that says which step needs a fix and why.
    [step, setStep] = useState(0),
    [stepError, setStepError] = useState('');
  const formRef = useRef<HTMLFormElement | null>(null),
    titleRef = useRef<HTMLHeadingElement | null>(null),
    afterStep = useRef<(() => void) | null>(null);
  const active = useRef(false),
    task = useRef<AbortController | null>(null),
    flight = useRef(false);
  const clear = useCallback((why: string) => {
    task.current?.abort();
    flight.current = false;
    setBusy(false);
    setView(null);
    setHistory(null);
    setDraft(empty);
    setAck(false);
    setDirty(false);
    setPending(null);
    setStep(0);
    setStepError('');
    setMessage(why);
  }, []);
  const apply = useCallback((v: View) => {
    setView(v);
    setDraft(toDraft(v.profile));
    setAck(false);
    setDirty(false);
    setPending(null);
    setStep(0);
    setStepError('');
  }, []);
  const headers = useCallback(
    (extra?: Record<string, string>) => ({
      'x-corridra-customer-subject': subject,
      'x-corridra-customer-issuer': issuer,
      ...extra,
    }),
    [subject, issuer],
  );
  const loadHistory = useCallback(
    async (signal: AbortSignal) => {
      const r = await fetch(
        '/api/customer-organisation-profiles?' +
          new URLSearchParams({ scope: 'history', workspaceId, pageSize: '10' }),
        { credentials: 'same-origin', cache: 'no-store', headers: headers(), signal },
      );
      if (!r.ok || signal.aborted) return null;
      const body = (await r.json()) as { workspaceId: string; revisions: Revision[] };
      return body.workspaceId === workspaceId && Array.isArray(body.revisions)
        ? body.revisions
        : null;
    },
    [workspaceId, headers],
  );
  const request = useCallback(
    async (body?: Record<string, unknown>) => {
      if (flight.current) return;
      flight.current = true;
      setBusy(true);
      task.current?.abort();
      const controller = new AbortController();
      task.current = controller;
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const r = await fetch(
          '/api/customer-organisation-profiles' +
            (body ? '' : '?' + new URLSearchParams({ workspaceId })),
          {
            method: body ? 'POST' : 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: headers(body ? { 'content-type': 'application/json' } : undefined),
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: controller.signal,
          },
        );
        if (!active.current || controller.signal.aborted) return;
        if ([401, 403].includes(r.status)) {
          clear('Access to this company profile changed. Local details were cleared.');
          return;
        }
        if (r.status === 409) {
          clear('Your account or the profile changed. Reload before editing.');
          return;
        }
        if (r.status === 503) {
          clear(
            realCustomerInput()
              ? 'The company profile is unavailable.'
              : 'The sample company profile is unavailable.',
          );
          return;
        }
        if (r.status === 400) {
          setPending(null);
          setMessage(
            'Check the required text, the website host, the country and the roles, then save again.',
          );
          return;
        }
        if (!r.ok) throw new ReplyError(`HTTP ${r.status}`);
        const v = parseView(onDeviceClock(await r.json(), r), workspaceId);
        if (
          body &&
          (v.commandId !== body.commandId ||
            v.profile?.version !== Number(body.expectedVersion) + 1)
        )
          throw Error('Save acknowledgement did not match');
        const revisions = v.canEdit ? await loadHistory(controller.signal).catch(() => null) : null;
        if (active.current && !controller.signal.aborted) {
          apply(v);
          if (body) setEditing(false);
          setHistory(revisions);
          setMessage(
            body
              ? 'Company profile saved.'
              : v.profile
                ? 'Company profile loaded.'
                : v.canEdit
                  ? realCustomerInput()
                    ? 'No company profile yet. Add your company details below.'
                    : 'No company profile yet. Add your sample details below.'
                  : 'No company profile has been added yet.',
          );
        }
      } catch (error) {
        if (active.current)
          setMessage(
            body
              ? 'Save could not be confirmed. Retry the same save.'
              : withReason(
                  'The company profile could not be loaded. Try again.',
                  loadReason(error, controller.signal.aborted),
                ),
          );
      } finally {
        clearTimeout(timeout);
        if (active.current) {
          flight.current = false;
          setBusy(false);
        }
      }
    },
    [workspaceId, headers, apply, clear, loadHistory],
  );
  useEffect(() => {
    active.current = true;
    void Promise.resolve().then(() => {
      if (active.current) void request();
    });
    const hide = () => {
      if (document.visibilityState === 'hidden')
        clear('Details cleared while away. Reload to check access.');
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      active.current = false;
      task.current?.abort();
      document.removeEventListener('visibilitychange', hide);
    };
  }, [request, clear]);
  useEffect(() => {
    if (!view) return;
    const timer = setTimeout(
      () => clear('Access must be checked again. Reload the company profile.'),
      Math.max(0, Date.parse(view.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [view, clear]);
  useEffect(() => {
    if (!dirty && !pending) return;
    const leave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [dirty, pending]);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
    setStepError('');
  };
  // A save that could not be confirmed is retried from the last step, where its button is.
  const shown = pending ? lastStep : step;
  // A step that is shown runs what was queued for it: the new step's title takes focus, or the control that needs a fix.
  useEffect(() => {
    const run = afterStep.current;
    afterStep.current = null;
    run?.();
  }, [step]);
  const goTo = (n: number, then: () => void) => {
    if (n === step) then();
    else {
      afterStep.current = then;
      setStep(n);
    }
  };
  // A control that needs a fix is always brought into view first, so a step never hides its own error.
  const showFix = (found: { field: Field; n: number }) => {
    const name =
      found.field.labels?.[0]?.textContent?.trim() ??
      found.field.getAttribute('aria-label') ??
      'A field';
    setStepError(
      `Step ${found.n + 1} of ${stepNames.length} needs a fix. ${name}: ${found.field.validationMessage}`,
    );
    goTo(found.n, () => {
      found.field.focus();
      found.field.reportValidity();
    });
  };
  const move = (to: number) => {
    setStepError('');
    goTo(to, () => titleRef.current?.focus());
  };
  const next = () => {
    const form = formRef.current;
    if (!form) return;
    const bad = firstInvalid(form, shown, shown);
    if (bad) showFix(bad);
    else move(shown + 1);
  };
  const submit = () => {
    if (!view?.canEdit || !ack || busy) return;
    const body = pending ?? {
      commandId: crypto.randomUUID(),
      workspaceId,
      expectedVersion: view.currentVersion,
      legalName: draft.legalName,
      countryCode: draft.countryCode.toUpperCase(),
      website: draft.website.trim() === '' ? null : draft.website.trim(),
      commercialRoles: draft.commercialRoles,
      sectors: draft.sectors
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      sizeBand: draft.sizeBand,
      summary: draft.summary,
      // CQ-28: a reason is asked for only when an existing profile changes. The first version
      // records a plain fixed reason, so the history still says why each version exists.
      reason:
        view.currentVersion === 0 && !draft.reason.trim()
          ? 'First version of the company profile'
          : draft.reason,
      acknowledged: true,
    };
    setPending(body);
    void request(body);
  };
  const profile = view?.profile ?? null;
  // The form is on screen. Stepped, it takes the place of the facts it would repeat; Cancel Editing brings them back.
  const formOpen = !!view?.canEdit && (!profile || editing || dirty || !!pending);
  const actions = (
    <>
      {steps && shown > 0 && !pending && (
        <button
          type="button"
          className="button-secondary"
          disabled={busy}
          onClick={() => move(shown - 1)}
        >
          Back
        </button>
      )}
      {steps && shown < lastStep ? (
        <button type="submit" className="button button-primary" disabled={busy}>
          Next
        </button>
      ) : (
        <button type="submit" className="button button-primary" disabled={busy || !ack}>
          {pending ? 'Retry Same Save' : 'Save Company Profile'}
        </button>
      )}
      {profile && !pending && (
        <button
          type="button"
          className="text-link"
          disabled={busy}
          onClick={() => {
            setDraft(toDraft(profile));
            setAck(false);
            setDirty(false);
            setEditing(false);
            setStep(0);
            setStepError('');
          }}
        >
          Cancel Editing
        </button>
      )}
    </>
  );
  return (
    <section aria-label={realCustomerInput() ? 'Company profile' : 'Sample company profile'}>
      {!framed && <p>{profileHelper()} </p>}
      <p role="status">{message}</p>
      {profile && !(steps && formOpen) && (
        <dl className="account-facts">
          <dt>Company</dt>
          <dd>{profile.legalName}</dd>
          <dt>Country</dt>
          <dd>{countryName(profile.countryCode)}</dd>
          <dt>Website</dt>
          <dd>{profile.website ?? 'Not provided'}</dd>
          <dt>Roles</dt>
          <dd>
            {profile.commercialRoles
              .map((r) => roleOptions.find(([value]) => value === r)?.[1] ?? r)
              .join(', ')}
          </dd>
          <dt>Sectors</dt>
          <dd>{profile.sectors.length ? profile.sectors.join(', ') : 'Not provided'}</dd>
          <dt>Company size</dt>
          <dd>{profile.sizeBand} people</dd>
          <dt>About</dt>
          <dd>{profile.summary}</dd>
          <dt>Version</dt>
          <dd>{profile.version}</dd>
          <dt>Status</dt>
          <dd>Self-reported, not verified</dd>
        </dl>
      )}
      {view?.canEdit && profile && !editing && !dirty && !pending && (
        <button
          type="button"
          className="button button-primary"
          disabled={busy}
          onClick={() => {
            setStep(0);
            setEditing(true);
          }}
        >
          Edit Company Profile
        </button>
      )}
      {formOpen && (
        <form
          ref={formRef}
          className={steps ? 'profile-form' : undefined}
          // Steps check their own controls in order (below), so a hidden control never blocks the save without a word.
          noValidate={steps || undefined}
          onSubmit={(e) => {
            e.preventDefault();
            if (!steps) return submit();
            if (shown < lastStep) return next();
            const form = formRef.current;
            const bad = form && firstInvalid(form, 0, lastStep);
            if (bad) showFix(bad);
            else submit();
          }}
        >
          <fieldset disabled={busy || !!pending}>
            <legend>
              {profile
                ? realCustomerInput()
                  ? 'Edit company profile'
                  : 'Edit sample company profile'
                : realCustomerInput()
                  ? 'Add company profile'
                  : 'Add sample company profile'}
            </legend>
            {steps && (
              <>
                <ol className="profile-steps" aria-label="Steps">
                  {stepNames.map((name, n) => (
                    <li key={name} aria-current={n === shown ? 'step' : undefined}>
                      <span className="profile-steps-number" aria-hidden="true">
                        {n + 1}
                      </span>
                      <span className="profile-steps-name">{name}</span>
                      <span className="sr-only">
                        {n < shown ? ' (done)' : n === shown ? ' (current step)' : ''}
                      </span>
                    </li>
                  ))}
                </ol>
                <h2 className="profile-step-title" ref={titleRef} tabIndex={-1}>
                  Step {shown + 1} of {stepNames.length}: {stepNames[shown]}
                </h2>
                {stepError && (
                  <p className="profile-step-error" role="alert">
                    {stepError}
                  </p>
                )}
              </>
            )}
            <Step n={0} on={steps} shown={shown}>
              <div>
                <label htmlFor={id + 'legalName'}>
                  {realCustomerInput() ? 'Company name' : 'Company name (start with Synthetic)'}
                </label>
                <input
                  id={id + 'legalName'}
                  required
                  minLength={realCustomerInput() ? 2 : 11}
                  maxLength={200}
                  value={draft.legalName}
                  onChange={(e) => set('legalName', e.target.value)}
                />
              </div>
              <div>
                <CountrySelect
                  id={id + 'countryCode'}
                  label="Country"
                  required
                  value={draft.countryCode ? draft.countryCode.toUpperCase() : null}
                  onChange={(code) => set('countryCode', code ?? '')}
                />
              </div>
              <div>
                <label htmlFor={id + 'website'}>
                  {realCustomerInput()
                    ? 'Website (optional)'
                    : 'Website (optional, example, test or invalid hosts only)'}
                </label>
                <input
                  id={id + 'website'}
                  maxLength={200}
                  placeholder={realCustomerInput() ? 'https://' : 'https://company.example'}
                  value={draft.website}
                  onChange={(e) => set('website', e.target.value)}
                />
              </div>
            </Step>
            <Step n={1} on={steps} shown={shown}>
              <fieldset>
                <legend>Roles this company plays</legend>
                {roleOptions.map(([value, label]) => (
                  <label key={value}>
                    <input
                      type="checkbox"
                      checked={draft.commercialRoles.includes(value)}
                      onChange={(e) =>
                        set(
                          'commercialRoles',
                          e.target.checked
                            ? [...draft.commercialRoles, value]
                            : draft.commercialRoles.filter((r) => r !== value),
                        )
                      }
                    />{' '}
                    {label}
                  </label>
                ))}
              </fieldset>
              <div>
                <label htmlFor={id + 'sectors'}>Sectors (comma separated, up to ten)</label>
                <input
                  id={id + 'sectors'}
                  maxLength={700}
                  value={draft.sectors}
                  onChange={(e) => set('sectors', e.target.value)}
                />
              </div>
              <div>
                <label htmlFor={id + 'sizeBand'}>Company size</label>
                <select
                  id={id + 'sizeBand'}
                  required
                  value={draft.sizeBand}
                  onChange={(e) => set('sizeBand', e.target.value)}
                >
                  <option value="">Choose a size</option>
                  {sizeOptions.map((size) => (
                    <option key={size} value={size}>
                      {size} people
                    </option>
                  ))}
                </select>
              </div>
            </Step>
            <Step n={2} on={steps} shown={shown}>
              <div>
                <label htmlFor={id + 'summary'}>
                  {realCustomerInput()
                    ? 'About the company'
                    : 'About the company (start with Synthetic)'}
                </label>
                <textarea
                  id={id + 'summary'}
                  required
                  minLength={realCustomerInput() ? 2 : 11}
                  maxLength={1000}
                  rows={4}
                  value={draft.summary}
                  onChange={(e) => set('summary', e.target.value)}
                />
              </div>
              {view.currentVersion > 0 && (
                <div>
                  <label htmlFor={id + 'reason'}>Reason for this change</label>
                  <input
                    id={id + 'reason'}
                    required
                    minLength={3}
                    maxLength={1000}
                    value={draft.reason}
                    onChange={(e) => set('reason', e.target.value)}
                  />
                </div>
              )}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.75rem',
                  marginBlock: '1rem',
                }}
              >
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I
                confirm these details are accurate to the best of my knowledge.{' '}
              </label>
            </Step>
          </fieldset>
          {steps ? <div className="profile-step-actions">{actions}</div> : actions}
        </form>
      )}
      {history && history.length > 0 && (
        <section aria-label="Profile history">
          <details className="account-fold">
            <summary>Change history ({history.length})</summary>
            <ol>
              {history.map((row) => (
                <li key={row.version}>
                  Version {row.version}: {row.reason}
                  {row.byYou ? ' (by you)' : ''}
                </li>
              ))}
            </ol>
          </details>
        </section>
      )}
      {!dirty && !pending && (
        <button type="button" className="text-link" disabled={busy} onClick={() => void request()}>
          Reload Company Profile
        </button>
      )}
      {!framed && (
        <a className="text-link" href="/account">
          Return to your account
        </a>
      )}
    </section>
  );
}
