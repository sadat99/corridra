'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CountryOptions } from './country-options';
type Catalogue = {
  routes: { id: string; origin_market: string; destination_market: string }[];
  packs: {
    id: string;
    route_id: string;
    origin_market: string;
    destination_market: string;
    status: string;
    version: number;
    configuration: unknown;
  }[];
  types: { id: string; key: string; description: string }[];
  requirements: { id: string; key: string }[];
  assessments: { id: string; key: string }[];
};
const commands = {
  'corridor-pack': {
    label: 'Append a reviewed corridor pack',
    help: 'Supply id, routeId, version, status, effectiveFrom, reason and configuration. Reference exact requirement and assessment versions listed below. A new pack does not reassign existing missions.',
    next: '#workspace-missions',
  },
  'ai-rights': {
    label: 'Record a source-rights review',
    help: 'Supply id, version, effectiveFrom, reason and policy. The policy records sourceId, licence, permittedReuse, role, purpose, classification, jurisdictions, subjectLocations, processingLocations, retentionUntil, legalHold, aiPermission, transferStatus and transferMechanism. A review cannot override source denial or extend retention.',
    next: '#workspace-ai',
  },
  'ai-policy': {
    label: 'Append a reviewed model policy',
    help: 'Supply policy, key, termsSourceId, dailyBudgetMinor, effectiveFrom and reason. Include the actual reviewed provider, model, secret reference, evaluation source, processing locations, task coverage, rates, limits and expiry. Never enter API key values. Deployment approval and credentials remain separate prerequisites.',
    next: '#workspace-ai',
  },
} as const;
type Command = keyof typeof commands;
export function ReviewSettings({ tenant, role }: { tenant: string; role: string }) {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [command, setCommand] = useState<Command>('corridor-pack'),
    [draft, setDraft] = useState(''),
    [next, setNext] = useState(''),
    [drafts, setDrafts] = useState<Partial<Record<Command, string>>>({});
  const request = useCallback(
    async (action: string, input?: unknown) => {
      const r = await fetch(
        '/api/workspace/' + action + '?tenant=' + encodeURIComponent(tenant),
        input === undefined
          ? {}
          : {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(input),
            },
      );
      const result = await r.json();
      if (!r.ok) throw new Error(result.error ?? 'The reviewed configuration could not be saved.');
      return result;
    },
    [tenant],
  );
  useEffect(() => {
    let active = true;
    request('mission-catalogue')
      .then((value) => {
        if (active) setCatalogue(value);
      })
      .catch((e) => {
        if (active) setMessage(e.message);
      });
    return () => {
      active = false;
    };
  }, [request]);
  async function save(action: string, input: unknown, destination: string) {
    setBusy(true);
    setMessage('');
    setNext('');
    try {
      const result = await request(action, input);
      const saved = result.id
        ? 'Saved reference: ' + result.id
        : 'Reviewed templates are available.';
      setMessage(saved);
      setNext(destination);
      try {
        setCatalogue(await request('mission-catalogue'));
      } catch {
        setMessage(
          saved +
            ' Configuration refresh failed. Use Refresh reviewed configuration to reload the references.',
        );
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Configuration could not be saved');
    } finally {
      setBusy(false);
    }
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      const input: unknown = JSON.parse(draft);
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error();
      if (new TextEncoder().encode(JSON.stringify(input)).length > 8192) {
        setMessage('Keep the reviewed command within 8 KiB.');
        return;
      }
      void save(command, input, commands[command].next);
    } catch {
      setMessage('Enter one valid JSON object. Your draft has been retained.');
    }
  }
  return (
    <section
      id="workspace-settings"
      tabIndex={-1}
      className="operator-section workspace-panel"
      aria-label="Corridor and policy settings"
    >
      <h2>Corridors and reviewed policies</h2>
      <p>
        Owner and admin reviews use existing versioned commands. Source, country, currency,
        permission and authenticator checks still apply. Use synthetic records until operational
        approvals are accepted.
      </p>
      <p role="status" aria-live="polite">
        {message}
      </p>
      <div className="workspace-links">
        <a href="#workspace-navigation">Back to workspace sections</a>
        <a href="#workspace-sources">Find source references</a>
        <a href="#workspace-authenticator">Confirm your authenticator</a>
        {role === 'owner' && <a href="#workspace-controls">Workspace switches</a>}
        {next && <a href={next}>Continue to the related workspace</a>}
      </div>
      <button
        className="text-link"
        disabled={busy}
        onClick={() =>
          void request('mission-catalogue')
            .then(setCatalogue)
            .catch((e) => setMessage(e.message))
        }
      >
        Refresh reviewed configuration
      </button>
      <details>
        <summary>Prepare commercial mission templates</summary>
        <p>
          Install the existing generic mission, requirement and assessment definitions. This does
          not create customer missions or approve a corridor.
        </p>
        <button
          disabled={busy}
          className="text-link"
          onClick={() => void save('mission-templates', {}, '#workspace-missions')}
        >
          Install missing mission templates
        </button>
      </details>
      <details>
        <summary>Create a directional corridor route</summary>
        <form
          className="operator-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void save(
              'corridor-route',
              {
                id: crypto.randomUUID(),
                origin: f.get('origin'),
                destination: f.get('destination'),
                reason: f.get('reason'),
              },
              '#workspace-settings',
            );
          }}
        >
          <label className="field">
            Demand-origin market
            <select name="origin" required>
              <option value="">Choose a market</option>
              <CountryOptions />
              <option value="EU">European Union trade bloc</option>
            </select>
          </label>
          <label className="field">
            Target market
            <select name="destination" required>
              <option value="">Choose a market</option>
              <CountryOptions />
              <option value="EU">European Union trade bloc</option>
            </select>
          </label>
          <label className="field">
            Route review reason
            <textarea name="reason" required minLength={3} maxLength={500} />
          </label>
          <p>
            The returned route reference is used in a reviewed pack. Creating a route grants no
            coverage or legal approval.
          </p>
          <button disabled={busy} className="primary-link">
            Create reviewed route
          </button>
        </form>
      </details>
      <details>
        <summary>Advanced versioned policy review</summary>
        <form className="operator-form" onSubmit={submit}>
          <label className="field">
            Reviewed configuration action
            <select
              value={command}
              onChange={(e) => {
                setDrafts((previous) => ({ ...previous, [command]: draft }));
                setCommand(e.target.value as Command);
                setDraft(drafts[e.target.value as Command] ?? '');
                setNext('');
                setMessage('');
              }}
              disabled={busy}
            >
              {Object.entries(commands).map(([value, item]) => (
                <option key={value} value={value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <p>{commands[command].help}</p>
          <label className="field">
            Reviewed command JSON
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              required
              rows={12}
              maxLength={8192}
              spellCheck={false}
            />
          </label>
          <label>
            <input type="checkbox" required /> I reviewed the source references, scope, effective
            dates and reason.
          </label>
          <button disabled={busy} className="primary-link">
            Save reviewed configuration
          </button>
        </form>
      </details>
      <details>
        <summary>Current route packs and definition references</summary>
        {catalogue ? (
          <>
            <h3>Directional route references</h3>
            <ul>
              {catalogue.routes.map((route) => (
                <li key={route.id}>
                  {route.origin_market} → {route.destination_market} · {route.id}
                </li>
              ))}
            </ul>
            <ul>
              {catalogue.packs.map((p) => (
                <li key={p.id}>
                  {p.origin_market} → {p.destination_market} · {p.status} · version {p.version}
                  <p>
                    Route: {p.route_id} · Pack: {p.id}
                  </p>
                  <details>
                    <summary>Inspect reviewed pack configuration</summary>
                    <pre className="ai-draft-preview">
                      {JSON.stringify(p.configuration, null, 2)}
                    </pre>
                  </details>
                </li>
              ))}
            </ul>
            {!catalogue.packs.length && (
              <p>
                No reviewed route pack is available yet. Create a route and append its reviewed
                pack.
              </p>
            )}
            {(['types', 'requirements', 'assessments'] as const).map((group) => (
              <div key={group}>
                <h3>
                  {group === 'types'
                    ? 'Mission types'
                    : group === 'requirements'
                      ? 'Requirements'
                      : 'Assessments'}
                </h3>
                <ul>
                  {catalogue[group].map((item) => (
                    <li key={item.id}>
                      {item.key} · {item.id}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </>
        ) : (
          <p>
            {message
              ? 'Configuration could not be loaded. Use Refresh reviewed configuration to retry.'
              : 'Loading reviewed configuration…'}
          </p>
        )}
      </details>
    </section>
  );
}
