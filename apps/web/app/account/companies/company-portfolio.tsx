'use client';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';

import { customerProvenanceAllowed } from '@corridra/domain/customer-input-mode';
import { useCallback, useEffect, useRef, useState } from 'react';
type Context = {
  resourceId: string;
  targetId: string;
  missionTitle: string;
  objective: string;
  company: string;
  country: string;
  fit: string;
  rationale: string;
  uncertainty: string;
  gaps: string;
  verification: string;
  expiresAt: string;
};
type Company = { id: string; contexts: Context[] };
type Page = {
  companies: Company[];
  nextAfter: string | null;
  scopesRead: number;
  unavailableScopes: number;
  expiresAt: string | null;
  synthetic: boolean;
};
type Props = { subject: string; issuer: string; serviceRequestsEnabled?: boolean };
const uuid = (s: unknown): s is string =>
  typeof s === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s);
const date = (s: unknown): s is string => typeof s === 'string' && Number.isFinite(Date.parse(s));
function validPage(value: unknown): value is Page {
  if (!value || typeof value !== 'object') return false;
  const p = value as Page;
  if (
    !customerProvenanceAllowed(p.synthetic) ||
    !Array.isArray(p.companies) ||
    p.companies.length > 150 ||
    !(p.nextAfter === null || uuid(p.nextAfter)) ||
    !Number.isInteger(p.scopesRead) ||
    p.scopesRead < 0 ||
    p.scopesRead > 5 ||
    !Number.isInteger(p.unavailableScopes) ||
    p.unavailableScopes < 0 ||
    p.unavailableScopes > p.scopesRead ||
    !(p.expiresAt === null || date(p.expiresAt))
  )
    return false;
  let contexts = 0;
  const ids = new Set<string>();
  for (const company of p.companies) {
    if (
      !company ||
      typeof company.id !== 'string' ||
      !/^[a-f0-9]{64}$/.test(company.id) ||
      ids.has(company.id) ||
      !Array.isArray(company.contexts) ||
      !company.contexts.length ||
      company.contexts.length > 150
    )
      return false;
    ids.add(company.id);
    const scopes = new Set<string>();
    for (const c of company.contexts) {
      if (
        !c ||
        !uuid(c.resourceId) ||
        !uuid(c.targetId) ||
        !date(c.expiresAt) ||
        Date.parse(c.expiresAt) <= Date.now() ||
        (p.expiresAt !== null && Date.parse(p.expiresAt) > Date.parse(c.expiresAt)) ||
        ![
          'missionTitle',
          'objective',
          'company',
          'country',
          'fit',
          'rationale',
          'uncertainty',
          'gaps',
          'verification',
        ].every(
          (k) =>
            typeof c[k as keyof Context] === 'string' &&
            (c[k as keyof Context] as string).length >= 1 &&
            (c[k as keyof Context] as string).length <= 2000,
        )
      )
        return false;
      const key = c.resourceId + ':' + c.targetId;
      if (scopes.has(key)) return false;
      scopes.add(key);
      contexts++;
    }
  }
  return contexts <= 150 && (p.companies.length === 0 || p.expiresAt !== null);
}
export function CompanyPortfolio(props: Props) {
  return <ScopedPortfolio key={props.issuer + ':' + props.subject} {...props} />;
}
function ScopedPortfolio({ subject, issuer, serviceRequestsEnabled = false }: Props) {
  const [rows, setRows] = useState<Company[]>([]),
    [next, setNext] = useState<string | null>(null),
    [scopes, setScopes] = useState(0),
    [unavailable, setUnavailable] = useState(0),
    [query, setQuery] = useState('');
  const [status, setStatus] = useState<
      'loading' | 'ready' | 'failed' | 'denied' | 'unavailable' | 'expired'
    >('loading'),
    [visible, setVisible] = useState(true),
    [busy, setBusy] = useState(false);
  const active = useRef(false),
    controller = useRef<AbortController | null>(null),
    expiry = useRef<ReturnType<typeof setTimeout> | null>(null),
    deadline = useRef<number | null>(null),
    cursors = useRef(new Set<string>());
  const clear = useCallback(() => {
    setRows([]);
    setNext(null);
    setScopes(0);
    setUnavailable(0);
    setQuery('');
    deadline.current = null;
    cursors.current.clear();
    if (expiry.current) clearTimeout(expiry.current);
  }, []);
  const load = useCallback(
    async (after?: string) => {
      controller.current?.abort();
      const task = new AbortController();
      controller.current = task;
      try {
        const response = await fetch(
          '/api/customer-companies' + (after ? '?after=' + encodeURIComponent(after) : ''),
          {
            credentials: 'same-origin',
            cache: 'no-store',
            headers: {
              'x-corridra-customer-subject': subject,
              'x-corridra-customer-issuer': issuer,
            },
            signal: task.signal,
          },
        );
        if (!active.current || task.signal.aborted) return;
        if ([401, 403, 409].includes(response.status)) {
          clear();
          setStatus('denied');
          return;
        }
        if (response.status === 503) {
          clear();
          setStatus('unavailable');
          return;
        }
        if (!response.ok) throw Error('Companies unavailable');
        const data: unknown = await response.json();
        if (!active.current || task.signal.aborted) return;
        if (
          !validPage(data) ||
          (data.expiresAt !== null && Date.parse(data.expiresAt) <= Date.now()) ||
          (data.nextAfter !== null &&
            (data.nextAfter === after || cursors.current.has(data.nextAfter)))
        )
          throw Error('Invalid company page');
        const d =
          data.expiresAt === null
            ? Date.now() + 60000
            : Math.min(Date.parse(data.expiresAt), Date.now() + 60000);
        deadline.current = after && deadline.current !== null ? Math.min(deadline.current, d) : d;
        if (deadline.current <= Date.now()) throw Error('Loaded scope expired');
        if (expiry.current) clearTimeout(expiry.current);
        expiry.current = setTimeout(() => {
          controller.current?.abort();
          clear();
          setStatus('expired');
          setBusy(false);
        }, deadline.current - Date.now());
        if (data.nextAfter) cursors.current.add(data.nextAfter);
        setRows((old) => {
          if (!after) return data.companies;
          const joined = new Map(old.map((c) => [c.id, c]));
          for (const company of data.companies) {
            const prior = joined.get(company.id);
            const contexts = prior
              ? [
                  ...prior.contexts,
                  ...company.contexts.filter(
                    (c) =>
                      !prior.contexts.some(
                        (p) => p.resourceId === c.resourceId && p.targetId === c.targetId,
                      ),
                  ),
                ]
              : company.contexts;
            joined.set(company.id, { id: company.id, contexts });
          }
          return [...joined.values()];
        });
        setNext(data.nextAfter);
        setScopes((n) => (after ? n + data.scopesRead : data.scopesRead));
        setUnavailable((n) => (after ? n + data.unavailableScopes : data.unavailableScopes));
        setStatus('ready');
      } catch {
        if (active.current && !task.signal.aborted) {
          clear();
          setStatus('failed');
        }
      } finally {
        if (active.current && !task.signal.aborted) setBusy(false);
      }
    },
    [subject, issuer, clear],
  );
  useEffect(() => {
    active.current = true;
    void Promise.resolve().then(() => {
      if (active.current) void load();
    });
    const hide = () => {
      controller.current?.abort();
      clear();
      setVisible(false);
    };
    const show = () => {
      clear();
      setVisible(true);
      setBusy(false);
      setStatus('loading');
      void load();
    };
    const visibility = () => (document.visibilityState === 'hidden' ? hide() : show());
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', show);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      active.current = false;
      controller.current?.abort();
      if (expiry.current) clearTimeout(expiry.current);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', show);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [clear, load]);
  if (!visible)
    return <p role="status">Company details are hidden. Access will be checked when you return.</p>;
  const search = query.trim().toLocaleLowerCase();
  const shown = rows.filter((c) =>
    c.contexts.some((x) =>
      [x.company, x.country, x.missionTitle, x.objective]
        .join(' ')
        .toLocaleLowerCase()
        .includes(search),
    ),
  );
  return (
    <section
      className="delivery-view ux-saved-commercial-report"
      aria-label="Your approved company portfolio"
    >
      <a className="text-link ux-back" href="/account#saved-commercial-missions">
        Back to my commercial missions
      </a>
      <p>
        {realCustomerInput()
          ? 'Your submitted information. These companies come from your saved, approved mission reports. Each mission keeps its own qualification and commercial purpose. Open its report for current approved commercial detail.'
          : 'Sample data only. These companies come from your saved, approved mission reports. Each mission keeps its own qualification and commercial purpose. Open its report for current approved commercial detail.'}{' '}
      </p>
      {status === 'loading' && <p role="status">Checking approved companies…</p>}
      {status === 'denied' && (
        <p role="alert">
          Company access could not be confirmed. Return to your account and check your access.
        </p>
      )}
      {status === 'unavailable' && <p role="status">Approved companies are unavailable.</p>}
      {status === 'failed' && (
        <p role="alert">Companies could not be loaded. Refresh and try again.</p>
      )}
      {status === 'expired' && (
        <p role="status">
          Refresh to check company access again. Earlier details have been cleared.
        </p>
      )}
      {status === 'ready' && (
        <>
          <p>
            {rows.length} approved {rows.length === 1 ? 'company' : 'companies'} from {scopes} saved
            mission {scopes === 1 ? 'report' : 'reports'} checked.
            {next ? ' More mission reports have not been loaded.' : ''}
          </p>
          {unavailable > 0 && (
            <p>
              {unavailable} saved {unavailable === 1 ? 'report is' : 'reports are'} unavailable. No
              company details from those reports are shown.
            </p>
          )}
          {rows.length > 0 && (
            <label className="field">
              Search loaded companies
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          )}
          {shown.length === 0 && (
            <p>
              {rows.length
                ? 'No loaded companies match this search.'
                : 'No companies are approved in these saved mission reports yet.'}
            </p>
          )}
          {shown.slice(0, 50).map((company) => (
            <article className="detail-card" key={company.id}>
              <h2>{company.contexts[0].company}</h2>
              <p>
                {company.contexts.length} approved{' '}
                {company.contexts.length === 1 ? 'report context' : 'report contexts'}
              </p>
              {serviceRequestsEnabled && (
                <p>
                  <a
                    className="text-link"
                    href={
                      '/account/service-requests/new?kind=company&ref=' +
                      encodeURIComponent(company.id)
                    }
                  >
                    Request help with this company
                  </a>
                </p>
              )}
              {company.contexts.map((context) => (
                <details key={context.resourceId + ':' + context.targetId}>
                  <summary>{context.missionTitle}</summary>
                  <p>
                    Approved name: {context.company} ({context.country})
                  </p>
                  <p>{context.objective}</p>
                  <p>
                    Fit: {context.fit.toLowerCase()} · {context.rationale}
                  </p>
                  <p>Uncertainty: {context.uncertainty}</p>
                  <p>Evidence gaps: {context.gaps}</p>
                  <p>{context.verification}</p>
                  <a className="text-link" href={'/account/missions/' + context.resourceId}>
                    Open approved commercial report
                  </a>
                </details>
              ))}
            </article>
          ))}
          {shown.length > 50 && (
            <p>Showing the first 50 matches. Narrow the search to find another loaded company.</p>
          )}
          {next && (
            <button
              type="button"
              className="text-link"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void load(next);
              }}
            >
              Load companies from more missions
            </button>
          )}
        </>
      )}
      {status !== 'loading' && (
        <button
          type="button"
          className="text-link"
          disabled={busy}
          onClick={() => {
            clear();
            setBusy(true);
            setStatus('loading');
            void load();
          }}
        >
          Refresh approved companies
        </button>
      )}
      <p>
        Only approved report information is shown. Company research and commercial authoring are not
        available here yet.
      </p>
    </section>
  );
}
