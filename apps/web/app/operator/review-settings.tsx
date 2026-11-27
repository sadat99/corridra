'use client';
import { OperatorWorkbench } from '../../components/operator-workbench';
import { PanelHeading } from './panel-heading';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { goLiveMessage, type GoLiveWarning } from '@corridra/domain/route-pack-standard';
import { CountryOptions } from './country-options';
import { ActionFeedback, useActionFeedback } from '../../components/ux/feedback';
import { DateTimeInput } from '../../components/ux/date-time-input';
import { readJson, withStepUp } from '../../lib/ux/step-up';
import { ConnectAiForm } from './connect-ai-form';
import { StatusBadge } from '../../components/access-state';
import { ShowMoreList } from '../../components/ux/show-more';
import { CountryName, countryName } from './country-name';
import { useOperatorFlags } from './operator-flags';
import './settings-routes.css';
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

const packTones = {
  DRAFT: 'neutral',
  TESTING: 'info',
  LIMITED: 'info',
  ACTIVE: 'positive',
  PAUSED: 'caution',
} as const;
/**
 * Team desk v4.1 (unit D17): the routes of the workspace, first on the page, each with the state of its newest
 * pack. Read only, from the catalogue the page already loads. A route without a pack says so and nothing more:
 * route and qualification stay two steps (decision 3), so no line here ties one to the other.
 */
function RouteList({ catalogue, failed }: { catalogue: Catalogue | null; failed: boolean }) {
  return (
    <div className="settings-routes">
      <h2 id="settings-routes-heading">Routes</h2>
      {!catalogue ? (
        <p className="ux-panel-empty">
          {failed
            ? 'Routes are unavailable. Refresh reviewed configuration to try again.'
            : 'Loading routes…'}
        </p>
      ) : !catalogue.routes.length ? (
        <p className="ux-panel-empty">
          No route yet. Open Create a directional corridor route below to add the first one.
        </p>
      ) : (
        <ShowMoreList limit={5} noun="routes" className="settings-routes-list">
          {catalogue.routes.map((route) => {
            const pack = catalogue.packs
              .filter((item) => item.route_id === route.id)
              .reduce<Catalogue['packs'][number] | null>(
                (newest, item) => (!newest || item.version > newest.version ? item : newest),
                null,
              );
            return (
              <li key={route.id}>
                <span className="settings-route-name">
                  <CountryName code={route.origin_market} size="row" />{' '}
                  {/* "to" stays with its destination when the row wraps on a narrow screen. */}
                  <span className="settings-route-end">
                    <span className="settings-route-to">to</span>{' '}
                    <CountryName code={route.destination_market} size="row" />
                  </span>
                </span>
                <span className="settings-route-pack">
                  {pack ? (
                    <>
                      <StatusBadge
                        tone={packTones[pack.status as keyof typeof packTones] ?? 'neutral'}
                      >
                        {packStatuses.find(([value]) => value === pack.status)?.[1] ??
                          words(pack.status)}
                      </StatusBadge>{' '}
                      <span className="settings-route-version">Pack version {pack.version}</span>
                    </>
                  ) : (
                    <StatusBadge tone="unknown">No pack yet</StatusBadge>
                  )}
                </span>
              </li>
            );
          })}
        </ShowMoreList>
      )}
    </div>
  );
}

/**
 * Guided "Add route pack" form (CQ-66). The server builds the reviewed pack command with
 * createRoutePack; nobody types JSON. Shown only when CORRIDRA_ROUTE_PACK_FORM is on: the server
 * answers 404 otherwise. Review stays required and the raw command stays under Advanced.
 * ADR-093 2b: once the server says the route pack module is active (`reviewed`), the form sends only
 * what the person set, so every key left alone is carried from the current pack, and the result
 * says what the reviewed publish did, then any go-live warnings (Core fields that are Pending).
 * Until then it sends and says exactly what it always did.
 */
function RoutePackForm({
  tenant,
  catalogue,
  onSaved,
  onShownChange,
}: {
  tenant: string;
  catalogue: Catalogue;
  onSaved: () => void;
  /** Told whether the form is drawn, so the panel can number its sections from what is shown. */
  onShownChange: (shown: boolean) => void;
}) {
  const [available, setAvailable] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [channelTouched, setChannelTouched] = useState(false);
  // Team desk v4.1: a route is named by its places, not by their codes. The value sent stays the route id.
  const { teamDeskV41: deskV41 } = useOperatorFlags();
  const [routeId, setRouteId] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const feedback = useActionFeedback();
  useEffect(() => {
    let live = true;
    fetch(`/api/team-control/route-pack?${new URLSearchParams({ tenant })}`, { cache: 'no-store' })
      .then(async (r) => {
        const body = r.ok
          ? ((await r.json().catch(() => null)) as { reviewed?: unknown } | null)
          : null;
        if (!live) return;
        setAvailable(r.ok);
        setReviewed(body?.reviewed === true);
        onShownChange(r.ok);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [tenant, onShownChange]);
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
    const lists = {
      languages: f.getAll('languages').map(String),
      currencies: f.getAll('currencies').map(String),
      timeZones: f.getAll('timeZones').map(String),
    };
    const manualChannel = f.get('manualChannel') === 'on';
    const body = reviewed
      ? {
          routeId,
          version: nextVersion,
          status: f.get('status'),
          ...(effectiveFrom ? { effectiveFrom } : {}),
          reason: f.get('reason'),
          missionTypes,
          ...Object.fromEntries(Object.entries(lists).filter(([, values]) => values.length)),
          ...(channelTouched ? { manualChannel } : {}),
        }
      : {
          routeId,
          version: nextVersion,
          status: f.get('status'),
          effectiveFrom: effectiveFrom ?? new Date(Date.now() + 60000).toISOString(),
          reason: f.get('reason'),
          missionTypes,
          ...lists,
          manualChannel,
        };
    setBusy(true);
    feedback.clear();
    try {
      const result = await withStepUp(async () =>
        readJson<{
          version?: number;
          duplicate?: boolean;
          removedPolicies?: string[];
          warnings?: GoLiveWarning[];
        }>(
          await fetch(`/api/team-control/route-pack?${new URLSearchParams({ tenant })}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
        ),
      );
      const removed = result.removedPolicies?.length
        ? ` Expired policies removed: ${result.removedPolicies.join(', ')}.`
        : '';
      const warned = (result.warnings ?? [])
        .map((warning) => ` ${goLiveMessage(warning)}`)
        .join('');
      feedback.success(
        typeof result.duplicate !== 'boolean'
          ? `Route pack version ${nextVersion} saved. Review is still required.`
          : result.duplicate
            ? 'Already saved. Nothing changed.'
            : `Route pack version ${result.version} published.${removed}${warned}`,
      );
      form.reset();
      setRouteId('');
      setEffectiveFrom(null);
      setChannelTouched(false);
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
                  {deskV41
                    ? `${countryName(route.origin_market)} to ${countryName(route.destination_market)}`
                    : `${route.origin_market} to ${route.destination_market}`}
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
            <input type="checkbox" name="manualChannel" onChange={() => setChannelTouched(true)} />{' '}
            The team contacts companies by hand (manual channel)
          </label>
          <label className="field">
            Reason for this pack
            <textarea name="reason" required minLength={3} maxLength={500} />
          </label>
          <button className="primary-link">{busy ? 'Saving…' : 'Save Route Pack'}</button>
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
    [drafts, setDrafts] = useState<Partial<Record<Command, string>>>({}),
    [aiConnectShown, setAiConnectShown] = useState(false),
    [routePackShown, setRoutePackShown] = useState(false),
    [catalogueFailed, setCatalogueFailed] = useState(false);
  // Team desk v4.1 (unit D17): routes first with their pack state; the page title and purpose line say the rest.
  const { teamDeskV41: deskV41 } = useOperatorFlags();
  // Section numbers follow what is drawn. With Connect AI off they are what they always were (Advanced 04, references 05,
  // whether or not Add route pack is shown as 03); with it on it takes the next number and the later sections move up one
  // only when Add route pack is also shown, so no number repeats.
  const step = (n: number) => String(n).padStart(2, '0');
  const aiStep = routePackShown ? 4 : 3;
  // Team desk v4.1: the numbers count what is drawn, so none is skipped (Advanced is 03 with no pack form and no
  // Connect AI). Off, they are what they always were.
  const advancedStep = deskV41
    ? 3 + Number(routePackShown) + Number(aiConnectShown)
    : aiConnectShown && routePackShown
      ? 5
      : 4;
  // Team desk v4.1: the numbers count what is drawn, so none is skipped (01, 02, 03 with no pack form and no Connect AI).
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
        if (!active) return;
        setMessage(e.message);
        setCatalogueFailed(true);
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
  const settingsHead = (
    <div className={deskV41 ? 'ux-settings-head settings-head-desk' : 'ux-settings-head'}>
      <p>
        Owner and admin reviews use existing versioned commands. Source, country, currency,
        permission and authenticator checks still apply. Use only records and actions approved for
        this workspace.
      </p>
      {/* Team desk v4.1 (owner, 24 Nov 2026: no repeated navigation links): the menu and the segments are the way
          to another place, so the links to menu places are not drawn. The one link left follows a save. */}
      {deskV41 ? (
        next && (
          <div className="workspace-links">
            <a href={next}>Continue to the related workspace</a>
          </div>
        )
      ) : (
        <div className="workspace-links">
          <a href="#workspace-navigation">Back to workspace sections</a>
          <a href="#workspace-sources">Find source references</a>
          <a href="#workspace-authenticator">Confirm your authenticator</a>
          {role === 'owner' && <a href="#workspace-controls">Workspace switches</a>}
          {next && <a href={next}>Continue to the related workspace</a>}
        </div>
      )}
    </div>
  );
  return (
    <section
      data-operator-workbench
      id="workspace-settings"
      tabIndex={-1}
      className={
        deskV41
          ? 'operator-section workspace-panel settings-desk'
          : 'operator-section workspace-panel'
      }
      aria-label="Corridor and policy settings"
    >
      {deskV41 ? (
        <RouteList catalogue={catalogue} failed={catalogueFailed} />
      ) : (
        <>
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
              // Listed only while the Connect AI section is drawn (its switch on), so the panel is otherwise unchanged.
              ...(aiConnectShown
                ? [{ label: 'Connect AI', heading: 'Connect an AI Provider' }]
                : []),
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
          {settingsHead}
        </>
      )}
      <p role="status" aria-live="polite">
        {message}
      </p>
      <div className="ux-settings-refresh">
        <button
          className="text-link"
          disabled={busy}
          aria-busy={busy}
          onClick={() => {
            if (busy) return;
            setBusy(true);
            void request('mission-catalogue')
              .then(setCatalogue)
              .catch((e) => setMessage(e.message))
              .finally(() => setBusy(false));
          }}
        >
          Refresh Reviewed Configuration
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
      </div>
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
            Install Missing Mission Templates
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
              Create Reviewed Route
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
            onShownChange={setRoutePackShown}
          />
        )}
        <ConnectAiForm tenant={tenant} step={step(aiStep)} onShownChange={setAiConnectShown} />
        <details>
          <summary data-step={step(advancedStep)}>
            Advanced (developers): versioned policy review
          </summary>
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
              Save Reviewed Configuration
            </button>
          </form>
        </details>
        <details>
          <summary data-step={step(advancedStep + 1)}>
            Current route packs and definition references
          </summary>
          {catalogue ? (
            <>
              <h3>Directional route references</h3>
              <ul>
                {catalogue.routes.map((route) => (
                  <li key={route.id}>
                    <CountryName code={route.origin_market} /> {deskV41 ? 'to' : '→'}{' '}
                    <CountryName code={route.destination_market} /> · {route.id}
                  </li>
                ))}
              </ul>
              <ul>
                {catalogue.packs.map((p) => (
                  <li key={p.id}>
                    <CountryName code={p.origin_market} /> {deskV41 ? 'to' : '→'}{' '}
                    <CountryName code={p.destination_market} /> · {p.status} · version {p.version}
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
      {deskV41 ? settingsHead : null}
    </section>
  );
}
