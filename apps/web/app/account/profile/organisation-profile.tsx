'use client';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
const roleOptions = [
  ['BUYER', 'Buyer'],
  ['SELLER', 'Seller'],
  ['SUPPLIER', 'Supplier'],
  ['MANUFACTURER', 'Manufacturer'],
  ['DISTRIBUTOR', 'Distributor'],
  ['ORGANISER', 'Delegation organiser'],
] as const;
const sizeOptions = ['1-10', '11-50', '51-200', '201-1000', '1000+'] as const;
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
  if (
    !v ||
    v.workspaceId !== workspaceId ||
    v.organisationId !== null ||
    v.canonicalLinked !== false ||
    v.provenance !== 'SELF_REPORTED' ||
    v.verified !== false ||
    typeof v.canEdit !== 'boolean' ||
    !Number.isInteger(v.currentVersion) ||
    v.currentVersion < 0 ||
    !Number.isFinite(Date.parse(v.expiresAt)) ||
    Date.parse(v.expiresAt) <= Date.now() ||
    Date.parse(v.expiresAt) > Date.now() + 65000
  )
    throw Error('Invalid company profile');
  if (v.profile !== null) {
    const p = v.profile;
    if (
      !p ||
      p.version !== v.currentVersion ||
      typeof p.legalName !== 'string' ||
      typeof p.countryCode !== 'string' ||
      typeof p.summary !== 'string' ||
      typeof p.sizeBand !== 'string' ||
      !(p.website === null || typeof p.website === 'string') ||
      !Array.isArray(p.commercialRoles) ||
      !Array.isArray(p.sectors)
    )
      throw Error('Invalid profile content');
  } else if (v.currentVersion !== 0) throw Error('Invalid profile content');
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
}) {
  const { subject, issuer, workspaceId } = props;
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
    [pending, setPending] = useState<Record<string, unknown> | null>(null);
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
    setMessage(why);
  }, []);
  const apply = useCallback((v: View) => {
    setView(v);
    setDraft(toDraft(v.profile));
    setAck(false);
    setDirty(false);
    setPending(null);
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
            'Check the required text, the website host, the country code and the roles, then save again.',
          );
          return;
        }
        if (!r.ok) throw Error('Profile request failed');
        const v = parseView(await r.json(), workspaceId);
        if (
          body &&
          (v.commandId !== body.commandId ||
            v.profile?.version !== Number(body.expectedVersion) + 1)
        )
          throw Error('Save acknowledgement did not match');
        const revisions = v.canEdit ? await loadHistory(controller.signal).catch(() => null) : null;
        if (active.current && !controller.signal.aborted) {
          apply(v);
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
      } catch {
        if (active.current)
          setMessage(
            body
              ? 'Save could not be confirmed. Retry the same save.'
              : 'The company profile could not be loaded. Try again.',
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
      reason: draft.reason,
      acknowledged: true,
    };
    setPending(body);
    void request(body);
  };
  const profile = view?.profile ?? null;
  return (
    <section aria-label={realCustomerInput() ? 'Company profile' : 'Sample company profile'}>
      <p>
        {realCustomerInput()
          ? 'Company details, kept private to this workspace. Everything here is self-reported and unverified, and it is not linked to any company record.'
          : 'Sample details only, kept private to this test workspace. Everything here is self-reported and unverified, and it is not linked to any company record.'}{' '}
      </p>
      <p role="status">{message}</p>
      {profile && (
        <dl>
          <dt>Company</dt>
          <dd>{profile.legalName}</dd>
          <dt>Country</dt>
          <dd>{profile.countryCode}</dd>
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
      {view?.canEdit && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
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
              <label htmlFor={id + 'countryCode'}>Country code</label>
              <input
                id={id + 'countryCode'}
                required
                pattern="[A-Za-z]{2}"
                maxLength={2}
                placeholder="BD"
                value={draft.countryCode}
                onChange={(e) => set('countryCode', e.target.value)}
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
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
                marginBlock: '1rem',
              }}
            >
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />{' '}
              {realCustomerInput()
                ? 'I confirm these details are accurate to the best of my knowledge.'
                : 'I confirm these are fictional planning details only.'}{' '}
            </label>
          </fieldset>
          <button type="submit" className="button button-primary" disabled={busy || !ack}>
            {pending ? 'Retry same save' : 'Save company profile'}
          </button>
        </form>
      )}
      {history && history.length > 0 && (
        <section aria-label="Profile history">
          <h2>Change history</h2>
          <ol>
            {history.map((row) => (
              <li key={row.version}>
                Version {row.version}: {row.reason}
                {row.byYou ? ' (by you)' : ''}
              </li>
            ))}
          </ol>
        </section>
      )}
      {!dirty && !pending && (
        <button type="button" className="text-link" disabled={busy} onClick={() => void request()}>
          Reload company profile
        </button>
      )}
      <a className="text-link" href="/account">
        Return to your account
      </a>
    </section>
  );
}
