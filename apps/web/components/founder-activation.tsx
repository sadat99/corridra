'use client';
import { useEffect, useState } from 'react';
import { StatusBadge } from './access-state';

type State = 'ON' | 'OFF' | 'WAITING_PREREQUISITE' | 'LOCKED_PRODUCTION' | 'LOCKED_NOT_SYNTHETIC';
type Activation = {
  environment: {
    deployment: string;
    data: string;
    productionUnlocked: boolean;
    openAdmission: boolean;
  };
  modules: { key: string; label: string; flag: string; state: State }[];
  counts: { on: number; total: number };
  note: string;
};
const states: Record<State, { text: string; tone: 'positive' | 'caution' | 'unknown' }> = {
  ON: { text: 'On', tone: 'positive' },
  OFF: { text: 'Off, flag unset', tone: 'unknown' },
  WAITING_PREREQUISITE: { text: 'Flag set, waiting for a prerequisite module', tone: 'caution' },
  LOCKED_PRODUCTION: { text: 'Locked, never runs in production', tone: 'caution' },
  LOCKED_NOT_SYNTHETIC: { text: 'Locked by the data environment setting', tone: 'caution' },
};

// The response is untrusted input to the browser: accept only the exact documented shape.
function parse(value: unknown): Activation | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const env = v.environment as Record<string, unknown> | undefined;
  const counts = v.counts as Record<string, unknown> | undefined;
  if (
    !env ||
    typeof env.deployment !== 'string' ||
    typeof env.data !== 'string' ||
    !counts ||
    !Number.isInteger(counts.on) ||
    !Number.isInteger(counts.total) ||
    typeof v.note !== 'string' ||
    !Array.isArray(v.modules)
  )
    return null;
  const modules: Activation['modules'] = [];
  for (const m of v.modules as Record<string, unknown>[]) {
    if (
      !m ||
      typeof m.key !== 'string' ||
      typeof m.label !== 'string' ||
      typeof m.flag !== 'string' ||
      typeof m.state !== 'string' ||
      !(m.state in states)
    )
      return null;
    modules.push({ key: m.key, label: m.label, flag: m.flag, state: m.state as State });
  }
  return {
    environment: {
      deployment: env.deployment,
      data: env.data,
      productionUnlocked: env.productionUnlocked === true,
      openAdmission: env.openAdmission === true,
    },
    modules,
    counts: { on: counts.on as number, total: counts.total as number },
    note: v.note,
  };
}

// `folded` puts the module table behind a disclosure on the busy Control Center page; the
// count sentence above it stays visible. The standalone view keeps the table open.
export function FounderActivation({
  tenant,
  folded = false,
}: {
  tenant: string;
  folded?: boolean;
}) {
  const [view, setView] = useState<
    { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: Activation }
  >({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/workspace/founder-activation?tenant=${encodeURIComponent(tenant)}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        const data = response.ok ? parse(await response.json()) : null;
        setView(data ? { status: 'ready', data } : { status: 'error' });
      })
      .catch(() => {
        if (!controller.signal.aborted) setView({ status: 'error' });
      });
    return () => controller.abort();
  }, [tenant]);
  if (view.status === 'loading') return <p aria-live="polite">Checking which modules are on.</p>;
  if (view.status === 'error')
    return (
      <p role="alert">
        Activation could not be read. Nothing is assumed to be on. Reload to try again.
      </p>
    );
  const { data } = view;
  const table = (
    <>
      <div className="operations-table" tabIndex={0} role="region" aria-label="Customer modules">
        <table>
          <caption>Customer modules and why each is on or off</caption>
          <thead>
            <tr>
              <th scope="col">Module</th>
              <th scope="col">State</th>
              <th scope="col">Flag</th>
            </tr>
          </thead>
          <tbody>
            {data.modules.map((m) => (
              <tr key={m.key}>
                <th scope="row">{m.label}</th>
                <td>
                  <StatusBadge tone={states[m.state].tone}>{states[m.state].text}</StatusBadge>
                </td>
                <td>
                  <code>{m.flag}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
  return (
    <div>
      <p aria-live="polite">
        This deployment is <strong>{data.environment.deployment}</strong> with{' '}
        <strong>{data.environment.data}</strong> data. {data.counts.on} of {data.counts.total}{' '}
        customer modules are on.
        {data.environment.productionUnlocked
          ? ' The owner unlocked these modules in production.'
          : ''}
        {data.environment.openAdmission
          ? ' Any email-verified account is admitted automatically.'
          : ''}
      </p>
      {folded ? (
        <details className="founder-modules">
          <summary>All {data.counts.total} customer modules and why each is on or off</summary>
          {table}
        </details>
      ) : (
        table
      )}
      <p>{data.note}</p>
    </div>
  );
}
