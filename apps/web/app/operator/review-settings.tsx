'use client';
import { OperatorWorkbench } from '../../components/operator-workbench';
import { PanelHeading } from './panel-heading';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CountryOptions } from './country-options';
import { ActionFeedback, useActionFeedback } from '../../components/ux/feedback';
import { DateTimeInput } from '../../components/ux/date-time-input';
import { readJson, withStepUp } from '../../lib/ux/step-up';
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

const packStatuses = [
  ['DRAFT', 'Draft, not used yet'],
  ['TESTING', 'Testing'],
  ['LIMITED', 'Limited use'],
  ['ACTIVE', 'Active'],
  ['PAUSED', 'Paused'],
] as const;
const packLanguages = [
  ['en', 'English'],
  ['bn', 'Bengali'],
  ['zh', 'Chinese'],
  ['es', 'Spanish'],
  ['ar', 'Arabic'],
  ['fr', 'French'],
  ['de', 'German'],
] as const;
const packCurrencies = [
  ['BDT', 'Bangladeshi Taka'],
  ['USD', 'US Dollar'],
  ['EUR', 'Euro'],
  ['CNY', 'Chinese Yuan'],
  ['GBP', 'British Pound'],
] as const;
const packZones = [
  ['Asia/Dhaka', 'Dhaka'],
  ['Europe/Madrid', 'Madrid'],
  ['Asia/Shanghai', 'Shanghai'],
  ['UTC', 'UTC'],
] as const;
const words = (code: string) => {
  const text = code
    .replace(/[_.-]+/g, ' ')
    .trim()
    .toLowerCase();
  return text ? text[0].toUpperCase() + text.slice(1) : code;
};

/**
 * Guided "Add route pack" form (CQ-66). The server builds the reviewed pack command with
 * createRoutePack; nobody types JSON. Shown only when CORRIDRA_ROUTE_PACK_FORM is on: the server
 * answers 404 otherwise. Review stays required and the raw command stays under Advanced.
 */
function RoutePackForm({
  tenant,
  catalogue,
  onSaved,
}: {
  tenant: string;
  catalogue: Catalogue;
  onSaved: () => void;
}) {
  const [available, setAvailable] = useState(false);
  const [routeId, setRouteId] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const feedback = useActionFeedback();
  useEffect(() => {
    let live = true;
    fetch(`/api/team-control/route-pack?${new URLSearchParams({ tenant })}`, { cache: 'no-store' })
      .then((r) => {
        if (live) setAvailable(r.ok);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [tenant]);
  if (!available) return null;
  const nextVersion =
    Math.max(0, ...catalogue.packs.filter((p) => p.route_id === routeId).map((p) => p.version)) + 1;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const f = new FormData(form);
    const missionTypes = f.getAll('missionTypes').map(String);
    if (!missionTypes.length) {
      feedback.error('Choose at least one mission type.');
      return;
    }
    setBusy(true);
    feedback.clear();
    try {
      await withStepUp(async () =>
        readJson(
          await fetch(`/api/team-control/route-pack?${new URLSearchParams({ tenant })}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              routeId,
              version: nextVersion,
              status: f.get('status'),
              effectiveFrom: effectiveFrom ?? new Date(Date.now() + 60000).toISOString(),
              reason: f.get('reason'),
              missionTypes,
              languages: f.getAll('languages').map(String),
              currencies: f.getAll('currencies').map(String),
              timeZones: f.getAll('timeZones').map(String),
              manualChannel: f.get('manualChannel') === 'on',
            }),
          }),
        ),
      );
      feedback.success(`Route pack version ${nextVersion} saved. Review is still required.`);
      form.reset();
      setRouteId('');
      setEffectiveFrom(null);
      onSaved();
    } catch (error) {
      feedback.error(error instanceof Error ? error.message : 'The route pack was not saved.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <details>
      <summary data-step="03">Add route pack</summary>
      <form className="operator-form" onSubmit={(event) => void submit(event)}>
        <fieldset disabled={busy}>
          <legend>New route pack</legend>
          <label className="field">
            Route
            <select
              name="route"
              required
              value={routeId}
              onChange={(event) => setRouteId(event.target.value)}
            >
              <option value="">Choose a route</option>
              {catalogue.routes.map((route) => (
                <option key={route.id} value={route.id}>
                  {route.origin_market} to {route.destination_market}
                </option>
              ))}
            </select>
          </label>
          {routeId && <p>This will be version {nextVersion} of the route pack.</p>}
          <fieldset>
            <legend>Mission types</legend>
            {catalogue.types.map((type) => (
              <label key={type.id} className="ux-check">
                <input type="checkbox" name="missionTypes" value={type.key} /> {words(type.key)}
              </label>
            ))}
          </fieldset>
          <label className="field">
            Status
            <select name="status" required defaultValue="">
              <option value="" disabled>
                Choose a status
              </option>
              {packStatuses.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <DateTimeInput
            label="Starts"
            hint="Leave empty to start one minute from now."
            value={effectiveFrom}
            onChange={setEffectiveFrom}
          />
          <fieldset>
            <legend>Languages</legend>
            {packLanguages.map(([value, label]) => (
              <label key={value} className="ux-check">
                <input type="checkbox" name="languages" value={value} /> {label}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Currencies</legend>
            {packCurrencies.map(([value, label]) => (
              <label key={value} className="ux-check">
                <input type="checkbox" name="currencies" value={value} /> {label}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Time zones</legend>
            {packZones.map(([value, label]) => (
              <label key={value} className="ux-check">
                <input type="checkbox" name="timeZones" value={value} /> {label}
              </label>
            ))}
          </fieldset>
          <label className="ux-check">
            <input type="checkbox" name="manualChannel" /> The team contacts companies by hand
            (manual channel)
          </label>
          <label className="field">
            Reason for this pack
            <textarea name="reason" required minLength={3} maxLength={500} />
          </label>
          <button className="primary-link">{busy ? 'Saving…' : 'Save route pack'}</button>
          <ActionFeedback
            scope="route-pack"
            feedback={feedback.feedback}
            onClear={feedback.clear}
          />
        </fieldset>
      </form>
    </details>
  );
}

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
      data-operator-workbench
      id="workspace-settings"
      tabIndex={-1}
      className="operator-section workspace-panel"
      aria-label="Corridor and policy settings"
    >
      <PanelHeading
        title="Corridors and reviewed policies"
        eyebrow="Settings and access"
        icon="globe"
        description="Prepare mission templates, define a route and review the policies that govern its use."
      />
      <OperatorWorkbench
        label="Reviewed configuration sections"
        sections={[
          { label: 'Mission templates', heading: 'Prepare commercial mission templates' },
          { label: 'Directional route', heading: 'Create a directional corridor route' },
          {
            label: 'Source rights and model policies',
            heading: 'Advanced (developers): versioned policy review',
          },
          {
            label: 'Pinned configuration references',
            heading: 'Current route packs and definition references',
          },
        ]}
      />
      <p>
        Owner and admin reviews use existing versioned commands. Source, country, currency,
        permission and authenticator checks still apply. Use only records and actions approved for
        this workspace.
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
      {catalogue ? (
        <dl className="ux-settings-counts">
          <div>
            <dt>Routes returned</dt>
            <dd>{catalogue.routes.length}</dd>
          </div>
          <div>
            <dt>Route packs returned</dt>
            <dd>{catalogue.packs.length}</dd>
          </div>
          <div>
            <dt>Mission types returned</dt>
            <dd>{catalogue.types.length}</dd>
          </div>
        </dl>
      ) : (
        <p className="ux-panel-empty">
          {message
            ? 'Reviewed references are unavailable. Refresh reviewed configuration to try again.'
            : 'Loading reviewed references…'}
        </p>
      )}
      <div className="ux-settings-sections">
        <details>
          <summary data-step="01">Prepare commercial mission templates</summary>
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
          <summary data-step="02">Create a directional corridor route</summary>
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
        {catalogue && (
          <RoutePackForm
            tenant={tenant}
            catalogue={catalogue}
            onSaved={() =>
              void request('mission-catalogue')
                .then(setCatalogue)
                .catch(() => undefined)
            }
          />
        )}
        <details>
          <summary data-step="04">Advanced (developers): versioned policy review</summary>
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
          <summary data-step="05">Current route packs and definition references</summary>
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
                      <pre
                        className="ai-draft-preview"
                        tabIndex={0}
                        role="region"
                        aria-label={`Reviewed pack configuration ${p.id}`}
                      >
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
      </div>
    </section>
  );
}
