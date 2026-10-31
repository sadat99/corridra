'use client';
import { FounderOverview } from '../../components/founder-overview';
import { ReferencePicker } from '../../components/ux/reference-picker';
import { PhoneFold } from '../../components/phone-fold';
import {
  OperatorWorkbench,
  useFormChangeGuard,
  formAcknowledged,
} from '../../components/operator-workbench';
import { SubmissionFailure } from '../../components/retained-submission';
import { displayDate } from '@corridra/domain/locale';
import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { formatMoney, currency } from '@corridra/domain/opportunities';
import {
  DEFERRED_LABEL,
  LIVE_STATE,
  blockedItems,
  deferredControls,
} from '@corridra/auth/deferred-controls';
type Row = Record<string, unknown>;
type Dashboard = {
  summary: Row;
  missions: Row[];
  corridraMoney: Row[];
  customerTrade: Row[];
  economics: Row[];
  programmes: Row[];
  repeat: Row[];
  commercialActivityTotals: Row[];
  financeAvailable: boolean;
  offset: number;
  limit: number;
  warnings: string[];
  definitions: Record<string, string>;
};
type Controls = {
  checkedAt: string;
  owners: Row[];
  readiness: Row[];
  releases: Row[];
  proposals: Row[];
  cases: Row[];
  documents: Row[];
  ledger: Row[];
  effort: Row[];
  contexts: Row[];
  privacy: Row[];
  policies: Row[];
  budgets: Row[];
  markets: Row[];
};
type Catalogue = {
  routes: { id: string; origin_market: string; destination_market: string }[];
  packs: {
    id: string;
    route_id: string;
    version: number;
    status: string;
    configuration: { missionTypes: string[] };
  }[];
};
const dimensions = [
  'offer',
  'owner',
  'qualification',
  'research',
  'communications',
  'coverage',
  'evidence',
  'privacy',
  'dependencies',
  'support',
  'quality',
  'rollback',
  'pilot',
];
const labels: Record<string, string> = {
  offer: 'Commercial offer and pricing',
  owner: 'Named operational owner',
  qualification: 'Qualification capability',
  research: 'Available counterparty research',
  communications: 'Approved communication',
  coverage: 'Language and operator coverage',
  evidence: 'Evidence requirements',
  privacy: 'Data, retention and legal checks',
  dependencies: 'External service dependencies',
  support: 'Customer support',
  quality: 'Quality assurance and escalation',
  rollback: 'Deployment and rollback',
  pilot: 'Real-user pilot acceptance',
};
const readinessLabels: Record<string, string> = {
  BLOCKED: 'Blocked',
  PASS: 'Ready',
  NOT_APPLICABLE: 'Not applicable',
};
const readinessLabel = (status: unknown) =>
  readinessLabels[String(status)] ?? String(status ?? 'Unknown');
const releaseLabels: Record<string, string> = {
  UNPUBLISHED: 'Not published',
  SYNTHETIC_APPROVED: 'Approved for limited use',
  PAUSED: 'Paused',
};
const releaseLabel = (state: string) => releaseLabels[state] ?? state;
/** A code shown as words: "market_access" becomes "Market access" (D9, CQ-32). */
const plainLabel = (code: string) => {
  const words = code
    .replace(/[_.-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : code;
};
const stageLabels: Record<string, string> = {
  LEAD: 'Lead',
  QUALIFIED_OPPORTUNITY: 'Qualified opportunity',
  PROPOSAL: 'Proposal',
  COMMITMENT: 'Commitment',
  CONTRACT: 'Contract',
  INVOICE: 'Invoice',
  CASH_COLLECTED: 'Cash collected',
  RECURRING_REVENUE: 'Recurring revenue',
  LOST: 'Lost',
};
/** The owner filter, chosen by name from the team (CQ-32). */
function FilterOwner({ tenant }: { tenant: string }) {
  const [owner, setOwner] = useState<string | null>(null);
  return (
    <ReferencePicker
      kind="reviewer"
      tenant={tenant}
      label="Owner"
      name="owner"
      value={owner}
      onChange={setOwner}
    />
  );
}
/** The readiness evidence source, chosen by name (D9). The hidden input keeps the form post. */
function ReadinessSource({ tenant }: { tenant: string }) {
  const [source, setSource] = useState<string | null>(null);
  return (
    <ReferencePicker
      kind="source"
      tenant={tenant}
      label="Readiness evidence source (optional)"
      name="source"
      value={source}
      onChange={setSource}
    />
  );
}
function value(v: unknown) {
  return v === null || v === undefined
    ? 'Unknown'
    : typeof v === 'boolean'
      ? v
        ? 'Yes'
        : 'No'
      : typeof v === 'object'
        ? JSON.stringify(v)
        : String(v);
}
function Table({
  rows,
  columns,
  label,
}: {
  rows: Row[];
  columns: [string, string][];
  label: string;
}) {
  return rows.length ? (
    <div className="operations-table" tabIndex={0} role="region" aria-label={label}>
      <table>
        <caption>{label}</caption>
        <thead>
          <tr>
            {columns.map(([k, l]) => (
              <th key={k} scope="col">
                {l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={String(r.id ?? i)}>
              {columns.map(([k]) => (
                <td key={k}>{value(r[k])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <p>
      No matching recorded observations. Missing financial or readiness evidence remains unknown.
    </p>
  );
}
export function Operations({
  tenant,
  role,
  section = 'ops-dashboard',
  purpose,
}: {
  tenant: string;
  role: string;
  section?: string;
  purpose?: string;
}) {
  const activeSection = ['ops-dashboard', 'ops-center', 'ops-health', 'ops-gates'].includes(section)
    ? section
    : 'ops-dashboard';
  const admin = ['owner', 'admin'].includes(role);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null),
    [controls, setControls] = useState<Controls | null>(null),
    [catalogue, setCatalogue] = useState<Catalogue | null>(null),
    [health, setHealth] = useState<{
      communications: Row[];
      tasks: Row[];
      ai: Row[];
      cases: Row[];
      health: Row;
      costWarning: string;
    } | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [filters, setFilters] = useState(''),
    [route, setRoute] = useState(''),
    [type, setType] = useState(''),
    [packDraft, setPackDraft] = useState(''),
    [preview, setPreview] = useState<Row | null>(null),
    [advanced, setAdvanced] = useState(''),
    [ack, setAck] = useState(false);
  const pending = useRef<{
    fingerprint: string;
    command: Row;
    form?: HTMLFormElement;
    uncertain: boolean;
  } | null>(null);
  const currentFilters = useRef('');
  const { ref: formRootRef, onChangeCapture, onResetCapture } = useFormChangeGuard<HTMLElement>();
  const [unacknowledged, setUnacknowledged] = useState(false);
  function changeScope(change: () => void) {
    if (
      (packDraft || advanced || formRootRef.current?.querySelector('form[data-ux-dirty="true"]')) &&
      !window.confirm(
        'Change the route or service? Unsaved readiness entries may be removed. Cancel to keep this view and its drafts.',
      )
    )
      return;
    change();
  }
  const request = useCallback(
    async (action: string, body?: unknown, query = '') => {
      const r = await fetch(
        `/api/workspace/${action}?tenant=${encodeURIComponent(tenant)}${query}`,
        body === undefined
          ? { cache: 'no-store' }
          : {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            },
      );
      const data = await r.json();
      if (!r.ok)
        throw new SubmissionFailure(
          data.error ?? 'Request failed',
          r.status,
          r.headers.get('X-Corridra-Request-ID'),
        );
      return data;
    },
    [tenant],
  );
  const load = useCallback(
    async (query = '') => {
      setBusy(true);
      setMessage('');
      try {
        const [d, h, c, a] = await Promise.all([
          request('operations-dashboard', undefined, query),
          request('operations-health'),
          request('mission-catalogue'),
          admin ? request('operations-controls') : Promise.resolve(null),
        ]);
        setDashboard(d);
        setHealth(h);
        setCatalogue(c);
        setControls(a);
        return true;
      } catch (e) {
        setMessage(e instanceof Error ? e.message : 'Operations could not load');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [admin, request],
  );
  // The workspace passes the section it is showing, which follows the address hash and, with the section
  // addresses on, the path (/operator/dashboard). Reading the section rather than the hash loads the same
  // data from either address.
  useEffect(() => {
    if (
      ['workspace-operations', 'ops-dashboard', 'ops-center', 'ops-health', 'ops-gates'].includes(
        section,
      )
    )
      void load(currentFilters.current);
  }, [section, load]);
  async function send(command: Row, form?: HTMLFormElement) {
    const fingerprint = JSON.stringify(command);
    if (pending.current && pending.current.fingerprint !== fingerprint) {
      setMessage(
        'An earlier command has no confirmed receipt. Retry its original entries before submitting another command.',
      );
      return;
    }
    if (!pending.current)
      pending.current = {
        fingerprint,
        command: structuredClone({ id: crypto.randomUUID(), ...command }),
        form,
        uncertain: false,
      };
    setBusy(true);
    setMessage('');
    try {
      await request('operations', pending.current.command);
      if (pending.current.form) formAcknowledged(pending.current.form);
      pending.current = null;
      setUnacknowledged(false);
      setMessage('Recorded. History is retained.');
      const refreshed = await load(filters);
      setMessage(
        refreshed
          ? 'Recorded. History is retained.'
          : 'Recorded. Refresh failed; refresh the view instead of resubmitting the received command.',
      );
    } catch (e) {
      const rejected = e instanceof SubmissionFailure && e.rejected && !pending.current?.uncertain;
      if (rejected) {
        pending.current = null;
        setUnacknowledged(false);
      } else {
        if (pending.current) pending.current.uncertain = true;
        setUnacknowledged(true);
      }
      setMessage(
        (e instanceof Error ? e.message : 'Request failed.') +
          (rejected ? '' : ' Receipt not confirmed. Retry original operational command.'),
      );
    } finally {
      setBusy(false);
    }
  }
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = new URLSearchParams();
    new FormData(event.currentTarget).forEach((v, k) => {
      if (String(v)) q.set(k, String(v));
    });
    const query = '&' + q.toString();
    setFilters(query);
    currentFilters.current = query;
    void load(query);
  }
  const pack = catalogue?.packs.find((p) => p.route_id === route),
    routeRow = catalogue?.routes.find((r) => r.id === route);
  const readings =
    controls?.readiness.filter((r) => r.route_id === route && r.mission_type === type) ?? [];
  function readiness(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pack) return;
    const f = new FormData(event.currentTarget),
      dimension = String(f.get('dimension')),
      old = readings.find((r) => r.dimension === dimension);
    void send(
      {
        action: 'readiness',
        routeId: route,
        packId: pack.id,
        missionType: type,
        dimension,
        version: Number(old?.version ?? 0) + 1,
        status: f.get('status'),
        ownerId: f.get('owner'),
        sourceId: f.get('source') || null,
        validUntil: new Date(String(f.get('until'))).toISOString(),
        reason: f.get('reason'),
      },
      event.currentTarget,
    );
  }
  function release(state: string) {
    if (!pack || !type) return;
    const old = controls?.releases.find((r) => r.route_id === route && r.mission_type === type);
    const owner =
      readings.find((r) => r.dimension === 'owner')?.owner_id ?? controls?.owners[0]?.user_id;
    if (!owner) {
      setMessage('Record an operational owner first.');
      return;
    }
    void send({
      action: 'release',
      routeId: route,
      packId: pack.id,
      missionType: type,
      version: Number(old?.version ?? 0) + 1,
      state,
      ownerId: owner,
      readinessIds: state === 'SYNTHETIC_APPROVED' ? readings.map((r) => r.id) : [],
      reason:
        state === 'PAUSED'
          ? 'Explicitly pause new assignments for this route service'
          : 'Independent route readiness review for limited use',
    });
  }
  function preparePack(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (!pack || !controls) return;
    if (
      packDraft &&
      !window.confirm('Replace the current configuration draft? Cancel to keep your entries.')
    )
      return;
    setPreview(null);
    setPackDraft(
      JSON.stringify(
        {
          id: crypto.randomUUID(),
          routeId: route,
          version: pack.version + 1,
          status: 'TESTING',
          effectiveFrom: new Date(Date.parse(controls.checkedAt) + 60000).toISOString(),
          configuration: pack.configuration,
          reason: 'Proposed configuration review',
        },
        null,
        2,
      ),
    );
  }
  async function inspect() {
    setBusy(true);
    setMessage('');
    try {
      const p = JSON.parse(packDraft);
      const result = await request('operations-preview', p);
      setPreview(result);
      setMessage('Preview only. Nothing has been published.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Invalid configuration');
    } finally {
      setBusy(false);
    }
  }
  const historyCount = controls
    ? [
        controls.budgets,
        controls.documents,
        controls.ledger,
        controls.effort,
        controls.contexts,
        controls.policies,
        controls.privacy,
      ].reduce((sum, rows) => sum + rows.length, 0)
    : 0;
  return (
    <section
      id="workspace-operations"
      tabIndex={-1}
      className="workspace-panel ux-governance-panel"
      data-operator-workbench
      ref={formRootRef}
      onChangeCapture={onChangeCapture}
      onResetCapture={onResetCapture}
    >
      <div className="ops-heading">
        <h2>Global operations</h2>
        <button
          className="button button-secondary"
          disabled={busy}
          onClick={() => void load(filters)}
        >
          {busy ? 'Loading operations…' : dashboard ? 'Refresh operations' : 'Load operations'}
        </button>
      </div>
      <OperatorWorkbench
        label="Operations workflow sections"
        sections={[
          {
            label: 'Mission funnel',
            panel: 'ops-dashboard',
            heading: 'Mission Operations dashboard',
          },
          {
            label: 'Service economics',
            panel: 'ops-dashboard',
            heading: 'Corridra fee revenue and delivery economics',
          },
          { label: 'Customer trade', panel: 'ops-dashboard', heading: 'Customer trade outcomes' },
          ...(admin
            ? [
                { label: 'Readiness review', panel: 'ops-center', heading: 'Readiness review' },
                {
                  label: 'Budgets, documents and effort',
                  panel: 'ops-center',
                  heading: 'Financial, effort and case records',
                },
              ]
            : []),
          { label: 'Recovery queue', panel: 'ops-health', heading: 'Recovery and health' },
          {
            label: 'Activation blockers',
            panel: 'ops-gates',
            heading: 'Production readiness and activation',
          },
        ].filter((item) => item.panel === activeSection)}
      />
      <p>
        {purpose === 'commercial_qualification'
          ? 'Founder visibility, route readiness and accountable recovery for this authorized workspace. Provider activation and independent approvals remain separate.'
          : 'Founder visibility, route readiness and accountable recovery. Corridra is live at small scale; creating an account does not by itself admit a customer request.'}
      </p>
      <p role="status" aria-live="polite" aria-label="Operations status">
        {message}
      </p>
      {unacknowledged && (
        <button
          className="button button-secondary"
          disabled={busy}
          onClick={() => {
            const original = pending.current;
            if (original) void send(JSON.parse(original.fingerprint));
          }}
        >
          Retry original operational command
        </button>
      )}
      <section
        id="ops-dashboard"
        tabIndex={-1}
        className="ux-operations-panel"
        hidden={activeSection !== 'ops-dashboard'}
      >
        <h3>Mission Operations dashboard</h3>
        <PhoneFold summary="Filter the records (10 filters)" className="ops-filters">
          <form onSubmit={filter} className="operator-form">
            <fieldset disabled={busy}>
              <legend>Filter canonical records in this workspace</legend>
              <label className="field">
                Directional route
                <select name="route">
                  <option value="">All routes, including unresolved</option>
                  {catalogue?.routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.origin_market} → {r.destination_market}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Mission type
                <select name="type" defaultValue="">
                  <option value="">All mission types</option>
                  {[...new Set(catalogue?.packs.flatMap((p) => p.configuration.missionTypes) ?? [])]
                    .sort()
                    .map((t) => (
                      <option key={t} value={t}>
                        {plainLabel(t)}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                Customer reference
                <input name="customer" minLength={3} maxLength={100} />
              </label>
              <label className="field">
                Industry
                <input name="industry" minLength={3} maxLength={100} />
              </label>
              <FilterOwner tenant={tenant} />
              <details className="ops-advanced-filters">
                <summary>Advanced (developers)</summary>
                <label className="field">
                  Corridor reference
                  <input name="corridor" />
                </label>
                <label className="field">
                  Programme reference
                  <input name="programme" />
                </label>
              </details>
              <label className="field">
                From intake date
                <input type="date" name="from" />
              </label>
              <label className="field">
                Through intake date
                <input type="date" name="to" />
              </label>
              <label className="field">
                Commercial stage
                <select name="stage">
                  <option value="">All stages</option>
                  {[
                    'LEAD',
                    'QUALIFIED_OPPORTUNITY',
                    'PROPOSAL',
                    'COMMITMENT',
                    'CONTRACT',
                    'INVOICE',
                    'CASH_COLLECTED',
                    'RECURRING_REVENUE',
                    'LOST',
                  ].map((k) => (
                    <option key={k} value={k}>
                      {stageLabels[k] ?? plainLabel(k)}
                    </option>
                  ))}
                </select>
              </label>
              <button className="button" type="submit">
                Apply filters
              </button>
            </fieldset>
          </form>
        </PhoneFold>
        {dashboard && (
          <>
            <p>{dashboard.definitions.scope}</p>
            <div className="ops-summary-grid">
              <section className="ux-next-action" aria-label="Recorded mission action queue">
                <h4>Recorded next actions on this page</h4>
                <p>
                  {dashboard.missions.length} records on this page of{' '}
                  {value(dashboard.summary.submitted)} matching submissions. Filter totals cover all
                  matching records. The list keeps server order and shows at most five recorded next
                  actions.
                </p>
                <ul>
                  {dashboard.missions
                    .filter((m) => m.next_action)
                    .slice(0, 5)
                    .map((m) => (
                      <li key={String(m.id)}>
                        <strong>{value(m.next_action)}</strong>
                        <p>
                          Mission {value(m.id)} · Owner {value(m.owner_id)} · Due{' '}
                          {m.due_at ? displayDate(String(m.due_at)) : 'Unknown'}
                        </p>
                      </li>
                    ))}
                </ul>
                {!dashboard.missions.some((m) => m.next_action) && (
                  <p>
                    No next action is recorded on this page. This does not imply that work is
                    complete.
                  </p>
                )}
                <a className="text-link" href="#workspace-missions">
                  Open mission review queue
                </a>
              </section>
              <div>
                <dl className="operations-metrics">
                  {Object.entries(dashboard.summary)
                    .slice(0, 6)
                    .map(([k, v]) => (
                      <div key={k}>
                        <dt>{k.replaceAll('_', ' ')}</dt>
                        <dd>{value(v)}</dd>
                      </div>
                    ))}
                </dl>
                <details className="ops-more-counts">
                  <summary>
                    {`${Math.max(0, Object.keys(dashboard.summary).length - 6)} more counts: denominators, unknown values and timing`}
                  </summary>
                  <dl className="operations-metrics">
                    {Object.entries(dashboard.summary)
                      .slice(6)
                      .map(([k, v]) => (
                        <div key={k}>
                          <dt>{k.replaceAll('_', ' ')}</dt>
                          <dd>{value(v)}</dd>
                        </div>
                      ))}
                  </dl>
                  <p>
                    Rejected missions, first useful result acceptance, retention rate and forecasts:
                    Unknown. Cancellation is shown separately. First recorded target timing is an
                    observable proxy.
                  </p>
                </details>
              </div>
            </div>
            <div className="ops-money-grid">
              <PhoneFold
                summary="Service economics: fees, costs and contribution (2 tables)"
                className="ops-money"
              >
                <h4>Corridra fee revenue and delivery economics</h4>
                <p>
                  {dashboard.financeAvailable
                    ? 'Original currency and integer minor units. Earned fee, invoiced fee and collected fee are distinct observations.'
                    : 'Financial records require owner/admin access. Their absence here does not mean zero.'}
                </p>
                <Table
                  label="Corridra financial observations"
                  rows={dashboard.corridraMoney}
                  columns={[
                    ['origin_market', 'Origin'],
                    ['destination_market', 'Destination'],
                    ['mission_type', 'Offering'],
                    ['kind', 'Record'],
                    ['currency', 'Currency'],
                    ['observed_minor', 'Observed minor units'],
                    ['recorded_mission_denominator', 'Recorded missions'],
                    ['completed_observed_minor', 'Completed mission amount'],
                    ['completed_recorded_denominator', 'Completed recorded missions'],
                  ]}
                />
                <Table
                  label="Per-mission contribution and effort"
                  rows={dashboard.economics.map((r) => ({
                    ...r,
                    contribution_margin:
                      r.contribution_margin_minor === null ||
                      r.contribution_margin_minor === undefined
                        ? 'Unknown; incomplete fee/cost coverage'
                        : formatMoney(
                            String(r.contribution_margin_minor),
                            currency.parse(r.currency),
                          ),
                    effort:
                      r.effort_minutes === null || r.effort_minutes === undefined
                        ? 'Unknown'
                        : `${r.effort_minutes} recorded minutes; completeness ${r.effort_complete === true ? 'attested' : 'unknown'}`,
                  }))}
                  columns={[
                    ['id', 'Mission'],
                    ['origin_market', 'Origin'],
                    ['destination_market', 'Destination'],
                    ['mission_type', 'Offering'],
                    ['status', 'Mission status'],
                    ['currency', 'Currency'],
                    ['observed_fee_minor', 'Observed earned fee minor units'],
                    ['observed_delivery_cost_minor', 'Observed delivery cost minor units'],
                    ['observed_reward_minor', 'Reward obligations minor units'],
                    ['contribution_margin', 'Contribution margin'],
                    ['effort', 'Effort'],
                  ]}
                />
              </PhoneFold>
              <PhoneFold
                summary="Customer trade, activity, programme and repeat records (4 tables)"
                className="ops-money"
              >
                <h4>Customer trade outcomes</h4>
                <p>
                  These are customer contract, invoice and cash observations. They are never counted
                  as Corridra revenue.
                </p>
                <Table
                  label="Customer trade amounts"
                  rows={dashboard.customerTrade}
                  columns={[
                    ['kind', 'Record'],
                    ['currency', 'Currency'],
                    ['observed_minor', 'Customer minor units'],
                    ['mission_denominator', 'Recorded missions'],
                  ]}
                />
                <Table
                  label="Commercial activity totals"
                  rows={dashboard.commercialActivityTotals}
                  columns={[
                    ['kind', 'Activity'],
                    ['recorded_observations', 'Recorded original observations'],
                    ['mission_denominator', 'Visible mission denominator'],
                  ]}
                />
                <Table
                  label="Programme yield and denominators"
                  rows={dashboard.programmes}
                  columns={[
                    ['name', 'Programme'],
                    ['matched_participants', 'Matching participants'],
                    ['total_participants', 'Total visible participants'],
                    ['participants_with_held_meetings', 'Participants with held meetings'],
                    ['completed_participants', 'Completed participants'],
                  ]}
                />
                <Table
                  label="Recorded repeat missions"
                  rows={dashboard.repeat}
                  columns={[
                    ['customer_reference', 'Customer reference'],
                    ['recorded_missions', 'Recorded missions'],
                    ['completed_missions', 'Completed missions'],
                  ]}
                />
              </PhoneFold>
            </div>
            <details className="ops-records">
              <summary>{`Mission records on this page (${dashboard.missions.length})`}</summary>
              <Table
                label="Filtered mission records"
                rows={dashboard.missions}
                columns={[
                  ['id', 'Mission'],
                  ['status', 'Status'],
                  ['mission_type', 'Type'],
                  ['owner_id', 'Owner'],
                  ['customer_reference', 'Customer'],
                  ['industry', 'Industry'],
                  ['acquisition_source', 'Acquisition observation'],
                  ['effort_minutes', 'Recorded effort minutes'],
                  ['first_useful_result_at', 'Recorded useful result'],
                  ['first_commercial_outcome_at', 'First observed contract or cash'],
                  ['commercial_counts', 'Commercial activities'],
                  ['opportunities', 'Opportunities and loss reasons'],
                  ['next_action', 'Next action'],
                  ['due_at', 'Due'],
                ]}
              />
              <button
                className="button button-secondary"
                disabled={busy || dashboard.offset === 0}
                onClick={() => void load(filters + `&offset=${Math.max(0, dashboard.offset - 50)}`)}
              >
                Previous missions
              </button>
              <button
                className="button button-secondary"
                disabled={
                  busy ||
                  dashboard.offset + dashboard.missions.length >=
                    Number(dashboard.summary.submitted)
                }
                onClick={() => void load(filters + `&offset=${dashboard.offset + 50}`)}
              >
                Next missions
              </button>
            </details>
            <details className="ops-notes-fold">
              <summary>{`How to read these numbers (${dashboard.warnings.length} notes)`}</summary>
              <div className="ops-notes">
                {dashboard.warnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
              </div>
            </details>
          </>
        )}
      </section>
      {admin && (
        <section
          id="ops-center"
          tabIndex={-1}
          className="ux-operations-panel"
          hidden={activeSection !== 'ops-center'}
        >
          <h3>Global Corridor Control Center</h3>
          <p className="ops-live-state">
            <strong>Status: {LIVE_STATE}.</strong> Open controls are deferred by the owner and
            listed under <a href="#ops-gates">Production readiness</a>. None of them is passed or
            approved.
          </p>
          <FounderOverview tenant={tenant} />
          <div className="ops-center-config">
            <div>
              <details>
                <summary>Configured country and market scopes</summary>
                <Table
                  label="Configured market scopes"
                  rows={
                    controls?.markets.filter((m) =>
                      catalogue?.routes.some(
                        (r) => r.origin_market === m.key || r.destination_market === m.key,
                      ),
                    ) ?? []
                  }
                  columns={[
                    ['key', 'Scope key'],
                    ['kind', 'Scope kind'],
                    ['name', 'Name'],
                    ['country_code', 'Country identity'],
                  ]}
                />
              </details>
              <label className="field">
                Control Center route
                <select
                  disabled={busy}
                  value={route}
                  onChange={(e) => {
                    changeScope(() => {
                      setRoute(e.target.value);
                      setType('');
                      setPreview(null);
                    });
                  }}
                >
                  <option value="">Choose a configured route</option>
                  {catalogue?.routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.origin_market} → {r.destination_market}
                    </option>
                  ))}
                </select>
              </label>
              {route && !pack && (
                <p>
                  This route has no effective pack. Create a reviewed configuration in Corridors and
                  policies before readiness review.
                </p>
              )}
              {pack && (
                <>
                  <p>
                    Current pack {pack.id}, version {pack.version}, {pack.status}. Changing
                    configuration invalidates readiness for the new version; historical assignments
                    remain pinned.
                  </p>
                  <label className="field">
                    Route service
                    <select
                      disabled={busy}
                      value={type}
                      onChange={(e) => changeScope(() => setType(e.target.value))}
                    >
                      <option value="">Choose an enabled mission type</option>
                      {pack.configuration.missionTypes.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="button button-secondary"
                    disabled={busy || role !== 'owner'}
                    onClick={preparePack}
                  >
                    Prepare next configuration version
                  </button>
                </>
              )}
              <PhoneFold summary="How to edit the configuration and where related settings are">
                <p>
                  Create routes and install reusable templates in{' '}
                  <a href="#workspace-settings">Corridors and policies</a>. Manage approved models
                  in <a href="#workspace-ai">AI assistance</a> and contributors in{' '}
                  <a href="#workspace-network">Execution network</a>. Credentials stay in secure
                  provider settings.
                </p>
                <p>
                  Edit enabled missionTypes, languages, currencies, timeZones, localities, clusters,
                  approved sourceCategories, channels, operatorCapabilities, coverage and exact
                  requirement/assessment/policy IDs. Bounded JSON is configuration data; no code or
                  policy expressions execute. Unsupported bindings fail validation.
                </p>
              </PhoneFold>
            </div>
            <div>
              <label className="field">
                Configuration draft
                <textarea
                  rows={12}
                  maxLength={8192}
                  value={packDraft}
                  onChange={(e) => {
                    setPackDraft(e.target.value);
                    setPreview(null);
                  }}
                />
              </label>
              <button
                className="button button-secondary"
                disabled={busy || !packDraft}
                onClick={() => void inspect()}
              >
                Preview configuration effects
              </button>
              {preview && (
                <>
                  <p>
                    Changed fields: {value(preview.changedFields)}. Historical assignments
                    preserved: {value(preview.historicalAssignmentsPreserved)}. Public operational
                    activation: No.
                  </p>
                  <button
                    className="button"
                    disabled={busy || role !== 'owner'}
                    onClick={() =>
                      void send({
                        action: 'propose',
                        basePackId: preview.basePackId,
                        pack: preview.pack,
                        reason: 'Submit the previewed exact configuration for independent review',
                      })
                    }
                  >
                    Submit configuration proposal
                  </button>
                </>
              )}
            </div>
          </div>
          {controls?.proposals
            .filter((p) => !p.decision)
            .map((p) => (
              <article key={String(p.id)}>
                <h4>Configuration proposal {String(p.id)}</h4>
                <p>
                  Proposed by {value(p.created_by)}, base {value(p.base_pack_id)}.
                </p>
                <details>
                  <summary>Inspect exact proposed pack</summary>
                  <pre
                    className="operations-json"
                    tabIndex={0}
                    role="region"
                    aria-label={`Exact proposed configuration ${String(p.id)}`}
                  >
                    {JSON.stringify(p.proposed_pack, null, 2)}
                  </pre>
                </details>
                <button
                  className="button"
                  disabled={busy || role !== 'owner'}
                  onClick={() =>
                    void send({
                      action: 'decide',
                      proposalId: p.id,
                      decision: 'PUBLISH',
                      reason: 'Independent exact configuration review and publication',
                    })
                  }
                >
                  Approve and publish exact proposal
                </button>
                <button
                  className="button button-secondary"
                  disabled={busy || role !== 'owner'}
                  onClick={() =>
                    void send({
                      action: 'decide',
                      proposalId: p.id,
                      decision: 'REJECT',
                      reason: 'Independent proposal rejection; retained for audit',
                    })
                  }
                >
                  Reject proposal
                </button>
              </article>
            ))}
          {pack && type && (
            <>
              <h4>Readiness review</h4>
              <p>
                Evidence checked {controls ? displayDate(controls.checkedAt) : 'Not checked'}.
                Effective status uses the current server review; the recorded decision remains
                historical. Missing or expired evidence stays blocked.
              </p>
              <h4>
                {routeRow?.origin_market} → {routeRow?.destination_market}: {type} readiness
              </h4>
              <Table
                label="Route readiness evidence"
                rows={dimensions.map((d) => {
                  const r = readings.find((r) => r.dimension === d);
                  const current = r && r.pack_id === pack.id && r.current === true;
                  return {
                    dimension: labels[d],
                    status: readinessLabel(current ? r.status : 'BLOCKED'),
                    recorded_status: r ? readinessLabel(r.status) : 'No observation',
                    valid_until: r?.valid_until ?? 'Unknown',
                    owner: r?.owner_id ?? null,
                    evidence: r?.source_id ?? null,
                    reason: r
                      ? current
                        ? r.reason
                        : 'Evidence expired or configuration changed'
                      : 'No approved evidence recorded',
                  };
                })}
                columns={[
                  ['dimension', 'Dimension'],
                  ['status', 'Status'],
                  ['recorded_status', 'Recorded decision'],
                  ['valid_until', 'Evidence valid until'],
                  ['owner', 'Owner'],
                  ['evidence', 'Source evidence'],
                  ['reason', 'Decision or blocker'],
                ]}
              />
              <form key={route + ':' + type} onSubmit={readiness} className="operator-form">
                <fieldset disabled={busy}>
                  <legend>Record a readiness observation with evidence</legend>
                  <label className="field">
                    Readiness dimension
                    <select name="dimension">
                      {dimensions.map((d) => (
                        <option value={d} key={d}>
                          {labels[d]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Readiness status
                    <select name="status" defaultValue="">
                      <option value="" disabled>
                        Choose a status
                      </option>
                      <option value="BLOCKED">Blocked</option>
                      <option value="PASS">Ready</option>
                      <option value="NOT_APPLICABLE">Not applicable (dependencies only)</option>
                    </select>
                  </label>
                  <label className="field">
                    Readiness owner
                    <select name="owner" required>
                      {controls?.owners.map((o) => (
                        <option key={String(o.user_id)} value={String(o.user_id)}>
                          {String(o.name)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <ReadinessSource tenant={tenant} />
                  <label className="field">
                    Readiness valid until
                    <input type="datetime-local" name="until" step="1" required />
                  </label>
                  <label className="field">
                    Readiness rationale
                    <input name="reason" minLength={3} maxLength={500} required />
                  </label>
                  <button className="button" type="submit">
                    Record readiness
                  </button>
                </fieldset>
              </form>
              <p>
                Release state:{' '}
                {releaseLabel(
                  String(
                    controls?.releases.find((r) => r.route_id === route && r.mission_type === type)
                      ?.state ?? 'UNPUBLISHED',
                  ),
                )}
                . Approval needs all thirteen current dimensions and an independent reviewer. It
                does not open the route to the public or make any public claim.
              </p>
              <button
                className="button"
                disabled={busy}
                onClick={() => release('SYNTHETIC_APPROVED')}
              >
                Approve route readiness for limited use
              </button>
              <button
                className="button button-secondary"
                disabled={busy}
                onClick={() => release('PAUSED')}
              >
                Pause this route service
              </button>
              <button
                className="button button-secondary"
                disabled={busy}
                onClick={() => release('UNPUBLISHED')}
              >
                Keep this route unpublished
              </button>
            </>
          )}
          <h4>Financial, effort and case records</h4>
          <p>
            Configuration publication and template changes retain owner-only authority. A different
            authorized owner must review a proposal. Financial and operational observations require
            fresh owner/admin authentication.
          </p>
          <div className="ops-command">
            <label className="field">
              Operational command JSON
              <textarea
                rows={10}
                maxLength={8192}
                value={advanced}
                onChange={(e) => setAdvanced(e.target.value)}
              />
            </label>
            <div>
              <details>
                <summary>Command fields</summary>
                <p>
                  AI budgets use action ai-budget, missionId, version, amountMinor as lifetime USD
                  minor units, sourceId and validUntil. A zero ceiling stops new reservations.
                  Existing tenant/day and task limits still apply. Templates use action template,
                  kind MISSION_TYPE/REQUIREMENT/ASSESSMENT, typeKey, version and description; only
                  registered schemas are released.
                </p>
                <p>
                  Record evidence-backed service invoices/receipts, earned fees/costs, effort,
                  completeness and owned recovery/privacy cases. Use original minor units and
                  currency. Compensations reference the original ID; no history is edited.
                </p>
                <p>
                  All commands use id, action and reason. document: missionId, kind INVOICE/RECEIPT,
                  parentId, reverseOf, amountMinor, currency, sourceId, externalReference,
                  occurredAt. ledger: missionId, kind SERVICE_FEE/DELIVERY_COST, reverseOf,
                  amountMinor, currency, sourceId, externalReference, occurredAt. effort: missionId,
                  operatorId, minutes, sourceId, occurredAt, reverseOf. context: missionId, version,
                  customerReference, industry, acquisitionSource, payingStatus
                  UNKNOWN/PAYING/NON_PAYING, optional intakeDecision UNKNOWN/ACCEPTED/REJECTED and
                  firstUsefulResultAt, revenueComplete, costComplete, effortComplete, sourceId.
                  case: key, version, kind, subjectId, state, ownerId, dueAt, sourceId. Nullable
                  values must be explicit null. Amounts are strings. Dates include their offset.
                </p>
              </details>
              <label>
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I
                reviewed the evidence, scope, original amounts and authorization.
              </label>
              <button
                className="button"
                disabled={busy || !ack || !advanced}
                onClick={() => {
                  try {
                    void send(JSON.parse(advanced));
                  } catch {
                    setMessage('Invalid command JSON. Your draft is retained.');
                  }
                }}
              >
                Record reviewed operational command
              </button>
            </div>
          </div>
          <details className="ops-history">
            <summary>
              {`Recorded budgets, documents, ledger, effort, context and policy history (${historyCount} records)`}
            </summary>
            <Table
              label="Mission AI budget versions"
              rows={controls?.budgets ?? []}
              columns={[
                ['mission_id', 'Mission'],
                ['version', 'Version'],
                ['amount_minor', 'Lifetime reserved USD minor-unit ceiling'],
                ['source_id', 'Approval evidence'],
                ['valid_until', 'Valid until'],
              ]}
            />
            <Table
              label="Service documents"
              rows={controls?.documents ?? []}
              columns={[
                ['id', 'ID'],
                ['mission_id', 'Mission'],
                ['kind', 'Kind'],
                ['parent_id', 'Original invoice parent'],
                ['external_reference', 'Original reference'],
                ['occurred_at', 'Recorded occurrence'],
                ['amount_minor', 'Minor units'],
                ['currency', 'Currency'],
                ['source_id', 'Source'],
                ['reverse_of', 'Compensates'],
              ]}
            />
            <Table
              label="Recent service ledger and compensation references, first 100"
              rows={controls?.ledger ?? []}
              columns={[
                ['id', 'Ledger ID'],
                ['mission_id', 'Mission'],
                ['kind', 'Kind'],
                ['amount_minor', 'Original minor units'],
                ['currency', 'Currency'],
                ['source_id', 'Evidence source'],
                ['reverse_of', 'Compensates'],
                ['external_reference', 'Reference'],
              ]}
            />
            <Table
              label="Recent effort history, first 100"
              rows={controls?.effort ?? []}
              columns={[
                ['id', 'Effort ID'],
                ['mission_id', 'Mission'],
                ['operator_id', 'Operator'],
                ['minutes', 'Recorded minutes'],
                ['source_id', 'Evidence source'],
                ['reverse_of', 'Compensates'],
              ]}
            />
            <Table
              label="Current mission operations context"
              rows={controls?.contexts ?? []}
              columns={[
                ['id', 'Version ID'],
                ['mission_id', 'Mission'],
                ['customer_reference', 'Customer reference'],
                ['industry', 'Industry'],
                ['paying_status', 'Paying classification'],
                ['revenue_complete', 'Fee coverage attested'],
                ['cost_complete', 'Cost coverage attested'],
                ['source_id', 'Evidence source'],
              ]}
            />
            <Table
              label="Recorded communication policy versions"
              rows={controls?.policies ?? []}
              columns={[
                ['id', 'Policy reference'],
                ['version', 'Version'],
                ['jurisdiction', 'Jurisdiction'],
                ['channel', 'Channel'],
                ['basis', 'Recorded basis'],
                ['enabled', 'Enabled flag'],
                ['effective_from', 'Effective from'],
                ['valid_until', 'Valid until'],
              ]}
            />
            <p>
              A recorded enabled flag does not approve outreach. Current policy, purpose, rights,
              opt-out and deployment checks still apply to each communication.
            </p>
            <Table
              label="Privacy policy versions"
              rows={controls?.privacy ?? []}
              columns={[
                ['id', 'Version ID'],
                ['source_id', 'Source'],
                ['data_role', 'Role'],
                ['jurisdictions', 'Jurisdictions'],
                ['processing_locations', 'Processing'],
                ['retention_until', 'Retention'],
                ['legal_hold', 'Legal hold'],
                ['transfer_status', 'Transfer review'],
              ]}
            />
          </details>
        </section>
      )}
      <section
        id="ops-health"
        tabIndex={-1}
        className="ux-operations-panel"
        hidden={activeSection !== 'ops-health'}
      >
        <h3>Recovery and health</h3>
        <p>
          PostgreSQL events and receipts remain authoritative. Leases expire after 30 seconds;
          transient attempts back off by 5, 10 and 20 seconds. Three failed attempts need an
          accountable operator decision. Replaying a received effect does not send it again.
        </p>
        {health && (
          <>
            <p>
              Database reachable: {value(health.health.database_reachable)}. Unscanned evidence:{' '}
              {value(health.health.unscanned)}. {health.costWarning}
            </p>
            <Table
              label="Communication recovery queue, first 100"
              rows={health.communications}
              columns={[
                ['id', 'Message'],
                ['status', 'Status'],
                ['attempts', 'Attempts'],
                ['owner_id', 'Accountable mission owner'],
                ['available_at', 'Available'],
                ['lease_until', 'Lease expires'],
                ['last_error', 'Safe error code'],
                ['workflow_run_id', 'Workflow'],
              ]}
            />
            {health.communications
              .filter((r) => ['DEAD', 'SUPPRESSED'].includes(String(r.status)))
              .map((r) => (
                <button
                  key={String(r.id)}
                  className="button button-secondary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await request('communication', {
                        action: 'retry',
                        commandId: crypto.randomUUID(),
                        messageId: r.id,
                        reason:
                          'Operator inspected the recovery queue and current policy before retry',
                      });
                      await load(filters);
                    } catch (e) {
                      setMessage(e instanceof Error ? e.message : 'Recovery failed');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Retry eligible message {String(r.id)}
                </button>
              ))}
            <button
              className="button button-secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await request('dispatch', {});
                  await load(filters);
                } catch (e) {
                  setMessage(
                    e instanceof Error ? e.message : 'Workflow start failed; retry is safe',
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Start or recover eligible dispatch
            </button>
            <Table
              label="Task queue, first 100"
              rows={health.tasks}
              columns={[
                ['id', 'Task'],
                ['mission_id', 'Mission'],
                ['action', 'Latest action'],
                ['owner_id', 'Reviewer'],
                ['deadline', 'Deadline'],
                ['expires_at', 'Expiry'],
              ]}
            />
            <Table
              label="AI failures and pending reservations, first 100"
              rows={health.ai}
              columns={[
                ['id', 'Run'],
                ['task', 'Task'],
                ['status', 'Completion'],
                ['result_status', 'Result'],
                ['reserved_minor', 'Reserved USD minor units'],
              ]}
            />
            <Table
              label="Owned recovery, privacy and fraud cases"
              rows={health.cases}
              columns={[
                ['key', 'Case'],
                ['kind', 'Kind'],
                ['state', 'State'],
                ['owner_id', 'Owner'],
                ['due_at', 'Due'],
                ['source_id', 'Closure evidence'],
                ['reason', 'Reason'],
              ]}
            />
          </>
        )}
        <p>
          Continue manual missions in <a href="#workspace-missions">Mission operations</a>, review
          failed drafts in <a href="#workspace-ai">AI assistance</a>, inspect contributor disputes
          in <a href="#workspace-network">Execution network</a> and retry publication through{' '}
          <a href="#workspace-delivery">Delivery</a>.
        </p>
      </section>
      <section
        id="ops-gates"
        tabIndex={-1}
        className="ux-operations-panel"
        hidden={activeSection !== 'ops-gates'}
      >
        <h3>Production readiness and activation</h3>
        <p className="ops-live-state">
          <strong>Status: {LIVE_STATE}.</strong> Corridra serves a small number of real customers.
          The controls below are open and deferred by the owner. None of them is passed or approved.
        </p>
        <Table
          label="Deferred controls"
          rows={deferredControls.map((control) => ({
            id: control.id,
            name: control.name,
            status: DEFERRED_LABEL,
            risk: control.risk,
            owner: control.whoActs,
          }))}
          columns={[
            ['id', 'Control'],
            ['name', 'What it covers'],
            ['status', 'Status'],
            ['risk', 'Risk while deferred'],
            ['owner', 'Who acts'],
          ]}
        />
        <Table
          label="Blocked"
          rows={blockedItems.map((item) => ({
            id: item.id,
            name: item.name,
            reason: item.reason,
            owner: item.whoActs,
          }))}
          columns={[
            ['name', 'Item'],
            ['reason', 'Why it is blocked'],
            ['owner', 'Who acts'],
          ]}
        />
        {admin && (
          <p>
            Repository settings for these controls (branch rules, secret scanning and code analysis)
            are described in the owner technical setup runbook,
            docs/runbooks/owner-technical-setup.md. Nothing on this page changes a setting or clears
            a control.
          </p>
        )}
        <p>
          Bangladesh to China: sourcing and machinery come before delegations. Bangladesh to Spain
          and the EU: buyer and export market access come before reverse services. Other routes stay
          unpublished. No readiness status can waive access checks, evidence quarantine, retention
          or legal approval.
        </p>
        <a className="text-link" href="#workspace-navigation">
          Return to workspace navigation
        </a>
      </section>
    </section>
  );
}
