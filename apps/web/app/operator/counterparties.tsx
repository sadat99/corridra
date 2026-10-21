'use client';
import { OperatorWorkbench } from '../../components/operator-workbench';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { CountryOptions } from './country-options';
type Row = { id: string; [key: string]: unknown };
type Organisation = Row & {
  name: string;
  country: string;
  domain: string;
  identity_status: string;
  canonical_id: string;
};
type Detail = {
  role: string;
  organisation: Organisation;
  aliasIds: string[];
  identities: Row[];
  relationships: Row[];
  contacts: Row[];
  notes: Row[];
  attributes: Row[];
  publicFacts: Row[];
  candidates: Row[];
  resolutions: Row[];
};
const txt = (r: Row, key: string) => String(r[key] ?? '');
const when = (v: unknown) => (v ? new Date(String(v)).toLocaleString() : 'Not recorded');
function Field({
  label,
  name,
  defaultValue = '',
  required = true,
  type = 'text',
}: {
  label: string;
  name: string;
  defaultValue?: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="field">
      {label}
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        maxLength={type === 'email' ? 200 : 1000}
      />
    </label>
  );
}
function Select({
  label,
  name,
  rows,
  empty = 'Choose a record',
  labelKey = 'locator',
  required = true,
}: {
  label: string;
  name: string;
  rows: Row[];
  empty?: string;
  labelKey?: string;
  required?: boolean;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} name={name} required={required}>
        <option value="">{empty}</option>
        {rows.map((r) => (
          <option key={r.id} value={r.id}>
            {txt(r, labelKey)}
          </option>
        ))}
      </select>
    </div>
  );
}
export function Counterparties({
  tenant,
  missionRevision = 0,
  purpose = 'synthetic_validation',
}: {
  tenant: string;
  missionRevision?: number;
  purpose?: string;
}) {
  const [catalogue, setCatalogue] = useState<{
      role: string;
      total: number;
      offset: number;
      organisations: Organisation[];
    } | null>(null),
    [q, setQ] = useState(''),
    [query, setQuery] = useState(''),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState(''),
    [detail, setDetail] = useState<Detail | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const [sources, setSources] = useState<Row[]>([]),
    [claims, setClaims] = useState<Row[]>([]),
    [missions, setMissions] = useState<Row[]>([]),
    [owners, setOwners] = useState<Row[]>([]),
    [mission, setMission] = useState(''),
    [shortlist, setShortlist] = useState<Row[]>([]),
    [shortOffset, setShortOffset] = useState(0),
    [shortTotal, setShortTotal] = useState(0);
  const pending = useRef(new Map<string, string>());
  async function get(action: string, params: Record<string, string | number> = {}) {
    const p = new URLSearchParams({
      tenant,
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    });
    const r = await fetch(`/api/workspace/${action}?${p}`, { cache: 'no-store' }),
      value = await r.json();
    if (!r.ok) throw new Error(value.error ?? 'Request failed');
    return value;
  }
  useEffect(() => {
    let active = true;
    get('research', { q: query, offset })
      .then((v) => {
        if (active) setCatalogue(v);
      })
      .catch((e) => {
        if (active) setMessage(e.message);
      });
    return () => {
      active = false;
    };
  }, [tenant, query, offset]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let active = true;
    Promise.all([get('workspace'), get('missions', { filter: 'all' })])
      .then(([w, m]) => {
        if (active) {
          setSources(w.sources);
          setClaims(w.claims);
          setMissions(
            m.missions.map((r: Row) => ({
              ...r,
              company_name: String((r.brief as { company: string })?.company ?? r.id),
            })),
          );
          setOwners(
            m.owners.map((o: { user_id: string; name: string }) => ({
              id: o.user_id,
              name: o.name,
            })),
          );
        }
      })
      .catch((e) => {
        if (active) setMessage(e.message);
      });
    return () => {
      active = false;
    };
  }, [tenant, missionRevision]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let active = true;
    if (selected)
      get('counterparty', { id: selected })
        .then((v) => {
          if (active) setDetail(v);
        })
        .catch((e) => {
          if (active) setMessage(e.message);
        });
    return () => {
      active = false;
    };
  }, [tenant, selected]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let active = true;
    if (mission)
      get('shortlist', { mission, offset: shortOffset })
        .then((v) => {
          if (active) {
            setShortlist(v.targets);
            setShortTotal(v.total);
          }
        })
        .catch((e) => {
          if (active) setMessage(e.message);
        });
    return () => {
      active = false;
    };
  }, [tenant, mission, shortOffset]); // eslint-disable-line react-hooks/exhaustive-deps
  async function reload() {
    const [c, w, m] = await Promise.all([
      get('research', { q: query, offset }),
      get('workspace'),
      get('missions', { filter: 'all' }),
    ]);
    setCatalogue(c);
    setSources(w.sources);
    setClaims(w.claims);
    setMissions(
      m.missions.map((r: Row) => ({
        ...r,
        company_name: String((r.brief as { company: string })?.company ?? r.id),
      })),
    );
    setOwners(
      m.owners.map((o: { user_id: string; name: string }) => ({ id: o.user_id, name: o.name })),
    );
    if (selected) setDetail(await get('counterparty', { id: selected }));
    if (mission) {
      const list = await get('shortlist', { mission, offset: shortOffset });
      setShortlist(list.targets);
      setShortTotal(list.total);
    }
  }
  async function send(body: Record<string, unknown>, action = 'research') {
    const key = JSON.stringify(body),
      commandId = pending.current.get(key) ?? crypto.randomUUID();
    pending.current.set(key, commandId);
    const r = await fetch(`/api/workspace/${action}?tenant=${tenant}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'research' ? { ...body, commandId } : body),
      }),
      value = await r.json();
    if (!r.ok) throw new Error(value.error ?? 'Request failed');
    pending.current.delete(key);
    return value;
  }
  async function act(work: () => Promise<unknown>, success = 'Research saved.') {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await work();
      await reload();
      setMessage(success);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }
  function form(
    event: FormEvent<HTMLFormElement>,
    body: (f: FormData) => Record<string, unknown>,
    action = 'research',
  ) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    void act(() => send(body(f), action));
  }
  const manage = catalogue && ['owner', 'admin', 'operator'].includes(catalogue.role),
    review = catalogue && ['owner', 'admin', 'reviewer'].includes(catalogue.role);
  const relations = detail?.relationships ?? [],
    attrs = detail?.attributes ?? [];
  const [validDefault] = useState(() =>
    new Date(Date.now() + 29 * 86400000).toISOString().slice(0, 16),
  );
  const publicSources = sources.filter(
    (s) => s.classification === 'PUBLIC' && s.kind === 'public_record',
  );
  return (
    <section
      data-operator-workbench
      className="operator-section research-workspace"
      aria-labelledby="research-heading"
    >
      <h2 id="research-heading">Counterparty research</h2>
      <OperatorWorkbench
        label="Research sections"
        sections={[
          { label: 'Search and sources', heading: 'Counterparty research' },
          { label: 'Public identities', heading: 'Original public identities' },
          { label: 'Evidence and claims', heading: 'Evidence and capabilities' },
          { label: 'Private relationships', heading: 'Private relationships' },
          { label: 'Matching', heading: 'Entity matching' },
          { label: 'Mission shortlist', heading: 'Mission shortlist' },
        ]}
      />
      <p>
        Research manually, keep the sources and explain the fit. A company record, certificate or
        strong fit assessment does not verify a commercial claim.
      </p>
      <p role="status" aria-live="polite" aria-label="Research status">
        {message}
      </p>
      <form
        className="operator-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q);
          setOffset(0);
        }}
      >
        <label className="field">
          Search companies
          <input
            disabled={busy}
            value={q}
            maxLength={100}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Company words, exact domain or identifier"
          />
        </label>
        <button disabled={busy}>Search</button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void act(async () => {}, 'Research refreshed.')}
        >
          Refresh research
        </button>
      </form>
      {catalogue ? (
        <>
          <p>
            {catalogue.total} company records. Shared identities are source-reported; private
            knowledge is shown only when your workspace permits it.
          </p>
          <div className="research-results">
            {catalogue.organisations.map((o) => (
              <button
                className="research-result"
                disabled={busy}
                type="button"
                aria-pressed={selected === o.id}
                key={o.id}
                onClick={() => {
                  setSelected(o.id);
                  setDetail(null);
                }}
              >
                <strong>{o.name}</strong>
                <span>
                  {o.country} · {o.domain ?? 'No public identifier'} ·{' '}
                  {o.identity_status === 'EXPIRED'
                    ? 'Identity evidence expired'
                    : o.identity_status === 'UNKNOWN'
                      ? 'No identity source recorded'
                      : 'Source-reported identity'}
                </span>
                {o.canonical_id !== o.id && <span>Merged attribution in this workspace</span>}
              </button>
            ))}
          </div>
          <div className="operator-toolbar">
            <button disabled={offset === 0 || busy} onClick={() => setOffset(offset - 50)}>
              Previous companies
            </button>
            <button
              disabled={offset + 50 >= catalogue.total || busy}
              onClick={() => setOffset(offset + 50)}
            >
              Next companies
            </button>
          </div>
        </>
      ) : (
        <p>
          {message
            ? 'Research could not be loaded. Verify current access, then retry.'
            : 'Loading research…'}
        </p>
      )}
      {manage && (
        <details className="research-panel">
          <summary>Record a research source and company</summary>
          <fieldset disabled={busy}>
            <form
              className="operator-form"
              onSubmit={(e) =>
                form(
                  e,
                  (f) => ({
                    kind: f.get('kind'),
                    locator: f.get('locator'),
                    classification: f.get('classification'),
                    purpose,
                    observedAt: new Date(String(f.get('observedAt')) + 'Z').toISOString(),
                    retentionUntil: new Date(String(f.get('retentionUntil')) + 'Z').toISOString(),
                    aiPolicy: 'DENY',
                  }),
                  'source',
                )
              }
            >
              <h3>Research source</h3>
              <label className="field">
                Source type
                <select name="kind">
                  <option value="public_record">Public record</option>
                  <option value="self_declaration">Self-declaration</option>
                  <option value="observation">Observation</option>
                </select>
              </label>
              <label className="field">
                Source visibility
                <select name="classification">
                  <option value="PUBLIC">Public company source</option>
                  <option value="INTERNAL">Workspace source</option>
                </select>
              </label>
              <Field
                label="Research source locator"
                name="locator"
                defaultValue="https://example.invalid/registry"
              />
              <Field
                label="Observed at (UTC)"
                name="observedAt"
                type="datetime-local"
                defaultValue={new Date().toISOString().slice(0, 16)}
              />
              <Field
                label="Retain source until (UTC)"
                name="retentionUntil"
                type="datetime-local"
                defaultValue={validDefault}
              />
              <p>
                Company ingestion accepts invented public records with a https://example.invalid
                source. No URL is fetched. AI use is denied.
              </p>
              <button className="primary-link">Save research source</button>
            </form>
            <form
              className="operator-form"
              onSubmit={(e) =>
                form(e, (f) => ({
                  action: 'ingest',
                  sourceId: f.get('sourceId'),
                  name: f.get('name'),
                  country: f.get('country'),
                  domain: f.get('domain'),
                  address: f.get('address'),
                  identifierType: f.get('identifierType'),
                  identifier: f.get('identifier'),
                }))
              }
            >
              <h3>Source-reported company identity</h3>
              <Select label="Public identity source" name="sourceId" rows={publicSources} />
              <Field label="Company name" name="name" />
              <label className="field">
                Company country
                <select name="country" defaultValue="BD">
                  <CountryOptions />
                </select>
              </label>
              <Field
                label="Invented company domain"
                name="domain"
                defaultValue="company.example.invalid"
              />
              <Field label="Public business address" name="address" />
              <label className="field">
                Identifier type
                <select name="identifierType">
                  <option value="registry">Registry</option>
                  <option value="tax">Tax</option>
                  <option value="source_id">Source record identifier</option>
                </select>
              </label>
              <Field label="Country-scoped identifier" name="identifier" />
              <p>
                Matching identifiers create candidates for review. They never merge companies
                automatically.
              </p>
              <button className="primary-link">Add company record</button>
            </form>
          </fieldset>
        </details>
      )}
      {selected && !detail && <p>Loading company workspace…</p>}
      {detail && (
        <div className="research-panel" key={selected}>
          <h3>{detail.organisation.name}</h3>
          <p>
            {detail.organisation.country} · {detail.aliasIds.length} original record
            {detail.aliasIds.length === 1 ? '' : 's'} in this workspace attribution. Original
            sources and relationship ownership are preserved.
          </p>
          <h4>Original public identities</h4>
          {detail.identities.map((i) => (
            <article className="research-evidence" key={i.id}>
              <strong>
                {txt(i, 'name')} · {txt(i, 'country')} · Original record {i.id.slice(0, 8)}
              </strong>
              <p>
                {txt(i, 'status')} · {txt(i, 'domain')} · {txt(i, 'identifier_type')}:{' '}
                {txt(i, 'identifier')} · {txt(i, 'address')}
              </p>
              <p>
                Public source: {txt(i, 'source_locator') || 'Not recorded'} · Observed{' '}
                {when(i.observed_at)} · Until {when(i.valid_until)}
              </p>
            </article>
          ))}
          <h4>Evidence and capabilities</h4>
          {attrs.length === 0 && detail.publicFacts.length === 0 && (
            <p>
              No sourced products, capabilities, certifications, requirements or markets recorded.
            </p>
          )}
          {attrs.map((a) => (
            <article className="research-evidence" key={a.id}>
              <strong>
                {txt(a, 'kind')}: {txt(a, 'statement')}
              </strong>
              <p className="evidence-label">
                {txt(a, 'status')} · Original claim: {txt(a, 'claim_status')}
              </p>
              <p>
                Source: {txt(a, 'locator')} · {txt(a, 'source_kind')} · Observed{' '}
                {when(a.observed_at)} · Valid until {when(a.valid_until)} · Retention{' '}
                {when(a.retention_until)} · AI: {txt(a, 'ai_policy')}
              </p>
              {a.fact_id ? (
                <p>
                  Review: {txt(a, 'method')} · Scope: {txt(a, 'scope')} · Until{' '}
                  {when(a.verification_valid_until)} · Malware scan:{' '}
                  {a.scan_status === 'BYPASSED' ? 'Not scanned' : txt(a, 'scan_status')}
                </p>
              ) : (
                <p>Evidence gap: no current independently verified fact linked.</p>
              )}
            </article>
          ))}
          {detail.publicFacts.map((a) => (
            <article className="research-evidence" key={a.id}>
              <strong>Shared public fact: {txt(a, 'statement')}</strong>
              <p>
                {txt(a, 'status')} · {txt(a, 'kind')} · {txt(a, 'source_locator')} · Observed{' '}
                {when(a.observed_at)} · Until {when(a.valid_until)}
              </p>
              <p>
                Review: {txt(a, 'method')} · Scope: {txt(a, 'scope')} · Malware scan:{' '}
                {a.scan_status === 'BYPASSED' ? 'Not scanned' : txt(a, 'scan_status')}
              </p>
            </article>
          ))}
          {manage && (
            <details>
              <summary>Add sourced product, capability, certificate, requirement or market</summary>
              <fieldset disabled={busy}>
                <form
                  className="operator-form"
                  onSubmit={(e) =>
                    form(
                      e,
                      (f) => ({ sourceId: f.get('sourceId'), statement: f.get('statement') }),
                      'claim',
                    )
                  }
                >
                  <Select label="Research claim source" name="sourceId" rows={sources} />
                  <Field label="Research claim statement" name="statement" />
                  <button>Record research claim</button>
                </form>
                <form
                  className="operator-form"
                  onSubmit={(e) =>
                    form(e, (f) => ({
                      action: 'attribute',
                      organisationId: selected,
                      kind: f.get('kind'),
                      claimId: f.get('claimId'),
                      validUntil: new Date(String(f.get('validUntil')) + 'Z').toISOString(),
                    }))
                  }
                >
                  <label className="field">
                    Company detail type
                    <select name="kind">
                      {['product', 'capability', 'certification', 'requirement', 'market'].map(
                        (k) => (
                          <option key={k}>{k}</option>
                        ),
                      )}
                    </select>
                  </label>
                  <Select
                    label="Attach original claim"
                    name="claimId"
                    rows={claims}
                    labelKey="statement"
                  />
                  <Field
                    label="Detail valid until (UTC)"
                    name="validUntil"
                    type="datetime-local"
                    defaultValue={validDefault}
                  />
                  <button>Attach company detail</button>
                </form>
              </fieldset>
            </details>
          )}
          {review && (
            <details>
              <summary>Publish an independently reviewed public fact</summary>
              <p>
                Only a current PUBLIC claim from a public-record source, reviewed by you through the
                independent evidence process, can be shared. Internal claims stay private. Confirm a
                fresh authenticator check first.
              </p>
              <form
                className="operator-form"
                onSubmit={(e) =>
                  form(e, (f) => {
                    const a = attrs.find((x) => x.id === f.get('attributeId'));
                    return {
                      action: 'publish',
                      attributeId: f.get('attributeId'),
                      factId: a?.fact_id,
                    };
                  })
                }
              >
                <Select
                  label="Verified public company detail"
                  name="attributeId"
                  rows={attrs.filter(
                    (a) => a.status === 'VERIFIED' && a.classification === 'PUBLIC',
                  )}
                  labelKey="statement"
                />
                <button disabled={busy}>Publish reviewed public fact</button>
              </form>
            </details>
          )}
          <h4>Private relationships</h4>
          {relations.length === 0 && (
            <p>
              No relationship visible to you. Hidden relationships, contacts and notes are never
              included in this view.
            </p>
          )}
          {relations.map((r) => (
            <article className="research-evidence" key={r.id}>
              <strong>
                {r.visibility === 'TEAM'
                  ? 'Shared with this workspace'
                  : 'Relationship owner and authorized oversight only'}
              </strong>
              <p>
                Owner:{' '}
                {(owners.find((o) => o.id === r.owner_id)?.name as string) ?? txt(r, 'owner_id')}
              </p>
              <p>{txt(r, 'note')}</p>
              {detail.contacts
                .filter((c) => c.relationship_id === r.id)
                .map((c) => (
                  <p key={c.id}>
                    {txt(c, 'name')} · {txt(c, 'job_title')} · {txt(c, 'email')} ·{' '}
                    {txt(c, 'status')} · Source {txt(c, 'source_id')} · Until {when(c.valid_until)}
                  </p>
                ))}
              {detail.notes
                .filter((n) => n.relationship_id === r.id)
                .map((n) => (
                  <p key={n.id}>
                    Private note: {txt(n, 'body')} · Source {txt(n, 'source_id')} ·{' '}
                    {when(n.created_at)}
                  </p>
                ))}
            </article>
          ))}
          {manage && (
            <details>
              <summary>Add a private relationship, contact or note</summary>
              <fieldset disabled={busy}>
                <form
                  className="operator-form"
                  onSubmit={(e) =>
                    form(e, (f) => ({
                      action: 'relationship',
                      organisationId: selected,
                      ownerId: f.get('ownerId'),
                      visibility: f.get('visibility'),
                      note: f.get('note'),
                    }))
                  }
                >
                  <Select label="Relationship owner" name="ownerId" rows={owners} labelKey="name" />
                  <label className="field">
                    Relationship visibility
                    <select name="visibility">
                      <option value="OWNER">Owner and authorized oversight</option>
                      <option value="TEAM">Workspace team</option>
                    </select>
                  </label>
                  <Field label="Relationship context" name="note" required={false} />
                  <button>Add private relationship</button>
                </form>
                <form
                  className="operator-form"
                  onSubmit={(e) =>
                    form(e, (f) => ({
                      action: 'contact',
                      relationshipId: f.get('relationshipId'),
                      sourceId: f.get('sourceId'),
                      name: f.get('name'),
                      jobTitle: f.get('jobTitle'),
                      email: f.get('email'),
                      validUntil: new Date(String(f.get('validUntil')) + 'Z').toISOString(),
                    }))
                  }
                >
                  <Select
                    label="Contact relationship"
                    name="relationshipId"
                    rows={relations}
                    labelKey="note"
                  />
                  <Select label="Contact source" name="sourceId" rows={sources} />
                  <Field label="Contact name" name="name" />
                  <Field label="Contact job title" name="jobTitle" />
                  <Field label="Invented contact email" name="email" type="email" />
                  <Field
                    label="Contact valid until (UTC)"
                    name="validUntil"
                    type="datetime-local"
                    defaultValue={validDefault}
                  />
                  <button>Add private contact</button>
                </form>
                <form
                  className="operator-form"
                  onSubmit={(e) =>
                    form(e, (f) => ({
                      action: 'note',
                      relationshipId: f.get('relationshipId'),
                      sourceId: f.get('sourceId'),
                      body: f.get('body'),
                    }))
                  }
                >
                  <Select
                    label="Note relationship"
                    name="relationshipId"
                    rows={relations}
                    labelKey="note"
                  />
                  <Select label="Private note source" name="sourceId" rows={sources} />
                  <Field label="Private research note" name="body" />
                  <button>Add private note</button>
                </form>
              </fieldset>
            </details>
          )}
          <h4>Entity matching and ambiguity</h4>
          {manage && (
            <button
              disabled={busy}
              onClick={() =>
                void act(() => send({ action: 'candidates', organisationId: selected }))
              }
            >
              Find deterministic candidates
            </button>
          )}
          {detail.candidates.length === 0 && (
            <p>
              No recorded candidates. A shared domain or address can describe different companies.
            </p>
          )}
          {detail.candidates.map((c) => {
            const history = detail.resolutions.filter((r) => r.candidate_id === c.id),
              active = history.find(
                (r) => r.decision !== 'REVERSE' && !history.some((u) => u.reverse_of === r.id),
              );
            return (
              <article className="research-evidence" key={c.id}>
                <strong>
                  {txt(c, 'left_name')} / {txt(c, 'right_name')}
                </strong>
                <p>{(c.reasons as string[]).join('; ')}</p>
                {history.map((r) => (
                  <p key={r.id}>
                    {txt(r, 'decision')}: {txt(r, 'reason')} · {when(r.created_at)}
                  </p>
                ))}
                {review &&
                  (active ? (
                    <button
                      disabled={busy}
                      onClick={() => {
                        const reason = window.prompt('Reason for reversing this attribution');
                        if (reason)
                          void act(() =>
                            send({ action: 'reverse', resolutionId: active.id, reason }),
                          );
                      }}
                    >
                      Reverse entity decision
                    </button>
                  ) : (
                    <form
                      className="operator-form"
                      onSubmit={(e) =>
                        form(e, (f) => ({
                          action: 'resolve',
                          candidateId: c.id,
                          decision: f.get('decision'),
                          survivorId: f.get('survivorId'),
                          reason: f.get('reason'),
                        }))
                      }
                    >
                      <label className="field">
                        Entity decision
                        <select name="decision">
                          <option value="DISTINCT">Keep distinct</option>
                          <option value="MERGE">Merge attribution in this workspace</option>
                        </select>
                      </label>
                      <label className="field">
                        Canonical survivor
                        <select name="survivorId" defaultValue={selected}>
                          <option value={txt(c, 'left_id')}>
                            {txt(c, 'left_name')}
                            {c.left_name === c.right_name
                              ? ` · ${txt(c, 'left_id').slice(0, 8)}`
                              : ''}
                          </option>
                          <option value={txt(c, 'right_id')}>
                            {txt(c, 'right_name')}
                            {c.left_name === c.right_name
                              ? ` · ${txt(c, 'right_id').slice(0, 8)}`
                              : ''}
                          </option>
                        </select>
                      </label>
                      <Field label="Entity review reason" name="reason" />
                      <button disabled={busy}>Record entity decision</button>
                    </form>
                  ))}
              </article>
            );
          })}
          {manage && (
            <details>
              <summary>Add this relationship to a mission shortlist</summary>
              <form
                className="operator-form"
                onSubmit={(e) =>
                  form(e, (f) => ({
                    action: 'target',
                    missionId: f.get('missionId'),
                    relationshipId: f.get('relationshipId'),
                    contactId: f.get('contactId') || null,
                    claimIds: f.getAll('claimIds'),
                    fit: f.get('fit'),
                    rationale: f.get('rationale'),
                    uncertainty: f.get('uncertainty'),
                    gaps: f.get('gaps'),
                    nextAction: f.get('nextAction'),
                    dueAt: new Date(String(f.get('dueAt')) + 'Z').toISOString(),
                  }))
                }
              >
                <fieldset disabled={busy}>
                  <Select
                    label="Target mission"
                    name="missionId"
                    rows={missions.filter((m) =>
                      ['ACTIVE', 'TARGETING'].includes(txt(m, 'status')),
                    )}
                    labelKey="company_name"
                  />
                  <Select
                    label="Target relationship"
                    name="relationshipId"
                    rows={relations}
                    labelKey="note"
                  />
                  <Select
                    label="Optional target contact"
                    name="contactId"
                    rows={detail.contacts.filter((c) => c.status !== 'EXPIRED')}
                    labelKey="name"
                    required={false}
                  />
                  <AssessmentFields attrs={attrs} validDefault={validDefault} />
                  <button>Add mission target</button>
                </fieldset>
              </form>
            </details>
          )}
        </div>
      )}
      <div className="research-panel">
        <h3>Mission shortlist</h3>
        <label className="field">
          Shortlist mission
          <select
            disabled={busy}
            value={mission}
            onChange={(e) => {
              setMission(e.target.value);
              setShortlist([]);
              setShortOffset(0);
              setShortTotal(0);
            }}
          >
            <option value="">Choose a mission</option>
            {missions.map((m) => (
              <option key={m.id} value={m.id}>
                {txt(m, 'company_name')} · {txt(m, 'status')}
              </option>
            ))}
          </select>
        </label>
        {mission && (
          <>
            <a
              className="text-link"
              href={`/api/workspace/shortlist-export?tenant=${tenant}&mission=${mission}&offset=${shortOffset}`}
            >
              Export this shortlist page as JSON
            </a>
            <p>
              {shortTotal} visible targets. Showing up to 50 per page. Fit assessments are operator
              judgments and do not establish verified facts.
            </p>
            <div className="operator-toolbar">
              <button
                disabled={busy || shortOffset === 0}
                onClick={() => setShortOffset(shortOffset - 50)}
              >
                Previous targets
              </button>
              <button
                disabled={busy || shortOffset + 50 >= shortTotal}
                onClick={() => setShortOffset(shortOffset + 50)}
              >
                Next targets
              </button>
            </div>
          </>
        )}
        {shortlist.map((t) => (
          <article className="research-evidence" key={t.id}>
            <h4>{txt(t, 'organisation_name')}</h4>
            <p>
              Fit: {txt(t, 'fit')} · Assessment version {txt(t, 'version')}
            </p>
            <p>Why: {txt(t, 'rationale')}</p>
            <p>Uncertainty: {txt(t, 'uncertainty')}</p>
            <p>Evidence gaps: {txt(t, 'gaps')}</p>
            <p>
              Next: {txt(t, 'next_action')} · Due {when(t.due_at)}
            </p>
            {(t.sources as Row[]).map((s, i) => (
              <p key={i}>
                {txt(s, 'statement')} · {txt(s, 'evidence_status')} · Original claim:{' '}
                {txt(s, 'status')} · {txt(s, 'locator')} · Observed {when(s.observed_at)} ·
                Retention {when(s.retention_until)}
              </p>
            ))}
            {(t.contacts as Row[]).map((c, i) => (
              <p key={i}>
                {txt(c, 'name')} · {txt(c, 'email')} · {txt(c, 'status')}
              </p>
            ))}
            <details>
              <summary>Assessment history</summary>
              {(t.history as Row[]).map((h) => (
                <p key={txt(h, 'version')}>
                  Version {txt(h, 'version')}: {txt(h, 'fit')} · {txt(h, 'rationale')} ·{' '}
                  {txt(h, 'uncertainty')} · {txt(h, 'gaps')} · {txt(h, 'next_action')}
                </p>
              ))}
            </details>
            {manage && (
              <details>
                <summary>Revise fit assessment</summary>
                <form
                  className="operator-form"
                  onSubmit={(e) =>
                    form(e, (f) => ({
                      action: 'assess',
                      targetId: t.id,
                      version: t.version,
                      claimIds: f.getAll('claimIds'),
                      fit: f.get('fit'),
                      rationale: f.get('rationale'),
                      uncertainty: f.get('uncertainty'),
                      gaps: f.get('gaps'),
                      nextAction: f.get('nextAction'),
                      dueAt: new Date(String(f.get('dueAt')) + 'Z').toISOString(),
                    }))
                  }
                >
                  <fieldset disabled={busy}>
                    <AssessmentFields
                      attrs={(t.sources as Row[]).map((s) => ({
                        ...s,
                        id: txt(s, 'claim_id'),
                        claim_id: s.claim_id,
                        status: s.evidence_status,
                      }))}
                      validDefault={validDefault}
                      initial={t}
                    />
                    <button>Save fit assessment</button>
                  </fieldset>
                </form>
              </details>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
function AssessmentFields({
  attrs,
  validDefault,
  initial,
}: {
  attrs: Row[];
  validDefault: string;
  initial?: Row;
}) {
  return (
    <>
      <label className="field">
        Fit judgment
        <select
          aria-label="Fit judgment"
          name="fit"
          defaultValue={initial ? txt(initial, 'fit') : 'RESEARCH'}
        >
          {['RESEARCH', 'POSSIBLE', 'STRONG', 'UNSUITABLE'].map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend>Attributable evidence for this target</legend>
        {attrs
          .filter((a) => a.status !== 'EXPIRED')
          .map((a) => (
            <label className="research-check" key={a.id}>
              <input
                type="checkbox"
                name="claimIds"
                value={txt(a, 'claim_id')}
                defaultChecked={!!initial}
              />
              {txt(a, 'statement')} · {txt(a, 'status')}
            </label>
          ))}
        <p>
          Select at least one current sourced claim. Expired claims cannot support a new assessment.
        </p>
      </fieldset>
      <Field
        label="Fit rationale"
        name="rationale"
        defaultValue={initial ? txt(initial, 'rationale') : ''}
      />
      <Field
        label="Remaining uncertainty"
        name="uncertainty"
        defaultValue={initial ? txt(initial, 'uncertainty') : ''}
      />
      <Field label="Evidence gaps" name="gaps" defaultValue={initial ? txt(initial, 'gaps') : ''} />
      <Field
        label="Target next action"
        name="nextAction"
        defaultValue={initial ? txt(initial, 'next_action') : ''}
      />
      <Field
        label="Target action due (UTC)"
        name="dueAt"
        type="datetime-local"
        defaultValue={initial ? String(initial.due_at).slice(0, 16) : validDefault}
      />
    </>
  );
}
