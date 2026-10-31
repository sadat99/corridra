'use client';
import { PhoneFold } from '../../components/phone-fold';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import {
  OperatorWorkbench,
  useFormChangeGuard,
  formAcknowledged,
} from '../../components/operator-workbench';
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import type { ImportRow } from '@corridra/delivery/import';
import { DeliveryExperience } from './delivery-experience';
import { DateTimeInput } from '../../components/ux/date-time-input';
import { formatDateTime } from '../../lib/ux/format';
import { readJson, withStepUp } from '../../lib/ux/step-up';
import { useFormDraft } from '../../lib/ux/use-form-draft';
type MissionChoice = {
  id: string;
  company: string;
  objective?: string;
  offer?: string;
  nextAction?: string;
  dueAt?: string;
};
// The delivery API answers several shapes; each caller reads the fields it needs, as before.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const weekAhead = () => new Date(Date.now() + 7 * 86400000).toISOString();
type Publication = {
  id: string;
  mission_id: string;
  copy: { title: string; company: string };
  revoked: boolean;
};
type Snapshot = {
  role: string;
  programmes: { id: string; name: string; reporting_purpose: string }[];
  programmeTotal: number;
  participants: {
    id: string;
    reference: string;
    mission_id: string;
    company: string;
    status: string;
  }[];
  publications: Publication[];
  links: {
    id: string;
    audience: string;
    reporting_purpose: string;
    expires_at: string;
    revoked: boolean;
  }[];
  requests: {
    id: string;
    title: string;
    instructions: string;
    status: string;
    response?: string;
  }[];
  owners: { user_id: string; name: string }[];
};
type Meeting = {
  id: string;
  mission_id: string;
  title: string;
  version: number;
  starts_at?: string;
  location?: string;
  status: string;
};
type Opportunity = { id: string; title: string; status: string };
type Preview = {
  id: string;
  rows: ImportRow[];
  counts: { ready: number; duplicates: number; empty: number; errors: number; total: number };
  expiresAt: string;
};
function values(form: HTMLFormElement) {
  return Object.fromEntries(new FormData(form)) as Record<string, string>;
}
function date(value: string) {
  return new Date(value).toISOString();
}
export function Delivery({ tenant, revision }: { tenant: string; revision: number }) {
  const { ref: formRootRef, onChangeCapture, onResetCapture, confirmChange } = useFormChangeGuard();
  const [data, setData] = useState<Snapshot | null>(null),
    [programme, setProgramme] = useState(''),
    [offset, setOffset] = useState(0),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [unavailable, setUnavailable] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null),
    [result, setResult] = useState<
      { row: number; reference: string; result: string; missionId?: string }[] | null
    >(null),
    [privateLink, setPrivateLink] = useState(''),
    [signInNeeded, setSignInNeeded] = useState(false);
  const [missions, setMissions] = useState<MissionChoice[]>([]),
    [missionId, setMissionId] = useState(''),
    [missionOffset, setMissionOffset] = useState(0),
    [missionTotal, setMissionTotal] = useState(0),
    [meetings, setMeetings] = useState<Meeting[]>([]),
    [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const publicationDraft = useFormDraft<Record<string, string>>(
    `delivery-publication:${tenant}:${missionId}`,
  );
  const chosen = missions.find((m) => m.id === missionId);
  const [selected, setSelected] = useState<string[]>([]),
    [audience, setAudience] = useState('CLIENT_PROGRESS');
  const [optionsMission, setOptionsMission] = useState('');
  const [dataScope, setDataScope] = useState('');
  const pending = useRef(new Map<string, string>()),
    uploadKey = useRef(''),
    currentScope = useRef(''),
    dataRequest = useRef(0);
  const endpoint = `/api/workspace/delivery?tenant=${encodeURIComponent(tenant)}`;
  const scope = `${endpoint}:${programme}:${offset}`;
  useLayoutEffect(() => {
    currentScope.current = scope;
  }, [scope]);
  // readJson throws ActionError, so a refused fresh-authenticator check can be re-verified in place (CQ-75).
  async function request(url: string, options?: RequestInit) {
    return readJson<Json>(await fetch(url, options));
  }
  async function load() {
    if (currentScope.current !== scope) return;
    const sequence = ++dataRequest.current;
    const value = await request(
      `${endpoint}&offset=${offset}${programme ? `&programme=${programme}` : ''}`,
    );
    if (currentScope.current === scope && dataRequest.current === sequence) {
      setData(value);
      setDataScope(scope);
    }
  }
  useEffect(() => {
    let active = true;
    const sequence = ++dataRequest.current;
    request(`${endpoint}&offset=${offset}${programme ? `&programme=${programme}` : ''}`)
      .then((value) => {
        if (active && dataRequest.current === sequence) {
          setData(value);
          setDataScope(scope);
          setUnavailable(false);
        }
      })
      .catch((e) => {
        if (active && dataRequest.current === sequence) {
          setMessage(e.message);
          setUnavailable(true);
        }
      });
    return () => {
      active = false;
    };
  }, [endpoint, offset, programme, revision, scope]);
  useEffect(() => {
    let active = true;
    request(`/api/workspace/missions?tenant=${tenant}&offset=${missionOffset}`)
      .then((value) => {
        if (active) {
          setMissions(
            value.missions.map(
              (m: {
                id: string;
                next_action?: string;
                due_at?: string;
                brief: { company: string; objective?: string; offer?: string };
              }) => ({
                id: m.id,
                company: m.brief.company,
                objective: m.brief.objective,
                offer: m.brief.offer,
                nextAction: m.next_action,
                dueAt: m.due_at,
              }),
            ),
          );
          setMissionTotal(value.total);
        }
      })
      .catch((e) => {
        if (active) setMessage(e.message);
      });
    return () => {
      active = false;
    };
  }, [tenant, missionOffset, revision]);
  useEffect(() => {
    let active = true;
    if (missionId)
      request(`${endpoint}&action=options&mission=${missionId}`)
        .then((options) => {
          if (active) {
            setMeetings(options.meetings);
            setOpportunities(options.opportunities);
            setOptionsMission(missionId);
          }
        })
        .catch((e) => {
          if (active) setMessage(e.message);
        });
    return () => {
      active = false;
    };
  }, [endpoint, missionId, revision]);
  async function action(action: string, input: Record<string, unknown>) {
    const key = `${action}:${JSON.stringify(input)}`;
    let commandId = pending.current.get(key);
    if (!commandId) {
      commandId = crypto.randomUUID();
      pending.current.set(key, commandId);
    }
    // The same command id is reused on the retry after a re-verify, so a repeat never duplicates the record.
    const value = await withStepUp(() =>
      request(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, input: { ...input, commandId } }),
      }),
    );
    pending.current.delete(key);
    return value;
  }
  async function act(work: () => Promise<void>, form?: HTMLFormElement) {
    setBusy(true);
    setMessage('');
    try {
      await work();
      if (form) formAcknowledged(form);
      await load();
      setMessage('Saved.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }
  function createProgramme(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const input = values(form);
    void act(async () => {
      const p = await action('programme', input);
      setProgramme(p.id);
    }, form);
  }
  function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form),
      file = f.get('file') as File;
    if (!programme || !file?.size) {
      setMessage('Choose a programme and an intake file.');
      return;
    }
    void act(async () => {
      uploadKey.current ||= crypto.randomUUID();
      const format = file.name.toLowerCase().endsWith('.xlsx') ? 'XLSX' : 'CSV';
      const next = await request(
        `${endpoint}&action=preview&programme=${programme}&format=${format}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'Idempotency-Key': uploadKey.current,
          },
          body: file,
        },
      );
      setPreview(next);
      setResult(null);
    }, form);
  }
  function confirm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    if (!preview) return;
    const f = values(form);
    void act(async () => {
      const r = await action('confirm', {
        importId: preview.id,
        ownerId: f.ownerId,
        counts: preview.counts,
        acknowledged: f.acknowledged === 'on',
      });
      setResult(r.rows);
    }, form);
  }
  function publish(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      f = new FormData(form),
      input = values(form);
    const selectedMeetings = meetings
      .filter((m) => f.getAll('meeting').includes(m.id))
      .map((m) => ({
        id: m.id,
        version: m.version,
        label: String(f.get(`meeting-label-${m.id}`)),
      }));
    void act(async () => {
      await action('publication', {
        missionId,
        title: input.title,
        company: input.company,
        objective: input.objective,
        brief: input.brief,
        nextAction: input.nextAction,
        dueAt: date(input.dueAt),
        meetings: selectedMeetings,
        opportunityIds: f.getAll('opportunity'),
        includeFinancials: input.includeFinancials === 'on',
        approved: input.approved === 'on',
      });
      publicationDraft.clear();
    }, form);
  }
  function share(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = values(form);
    void act(async () => {
      const link = await action('share', {
        programmeId: audience === 'INSTITUTION_REPORT' ? programme : null,
        publicationIds: selected,
        audience,
        purpose: f.purpose,
        expiresAt: date(f.expiresAt),
        allowExport: audience === 'INSTITUTION_REPORT' && f.allowExport === 'on',
        includeDelegation: audience === 'INSTITUTION_REPORT' && f.includeDelegation === 'on',
        approved: f.approved === 'on',
      });
      setPrivateLink(`${window.location.origin}${link.path}#${link.token}`);
      setSignInNeeded(link.signInNeededForLiveWorkspaces === true);
    }, form);
  }
  function evidenceRequest(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = values(form);
    void act(async () => {
      await action('request', { ...f, dueAt: date(f.dueAt) });
    }, form);
  }
  if (unavailable)
    return (
      <section data-operator-workbench className="detail-card">
        <h2>Client and programme delivery</h2>
        <OperatorWorkbench
          label="Publication and reporting sections"
          sections={[
            { label: 'Programmes', heading: 'Create programme' },
            { label: 'Participants', heading: 'Participants' },
            { label: 'Publication', heading: 'Review client publication' },
            { label: 'Private scope', heading: 'Share approved view' },
            { label: 'Access and requests', heading: 'Access and requests' },
          ]}
        />
        <p>{message}</p>
        <button
          className="text-link"
          disabled={busy}
          onClick={() =>
            void load()
              .then(() => {
                setUnavailable(false);
                setMessage('');
              })
              .catch((e) => setMessage(e.message))
          }
        >
          Retry delivery
        </button>
        <a href="#workspace-authenticator">Verify current access</a>
      </section>
    );
  if (!data || dataScope !== scope)
    return (
      <section data-operator-workbench className="detail-card">
        <h2>Client and programme delivery</h2>
        <OperatorWorkbench
          label="Publication and reporting sections"
          sections={[
            { label: 'Programmes', heading: 'Create programme' },
            { label: 'Participants', heading: 'Participants' },
            { label: 'Publication', heading: 'Review client publication' },
            { label: 'Private scope', heading: 'Share approved view' },
            { label: 'Access and requests', heading: 'Access and requests' },
          ]}
        />
        <p>{message || 'Loading delivery…'}</p>
        <button
          className="text-link"
          disabled={busy}
          onClick={() =>
            void load()
              .then(() => {
                setUnavailable(false);
                setMessage('');
              })
              .catch((e) => setMessage(e.message))
          }
        >
          Retry delivery
        </button>
        <a href="#workspace-authenticator">Verify current access</a>
      </section>
    );
  const manages = ['owner', 'admin', 'operator'].includes(data.role),
    shares = ['owner', 'admin'].includes(data.role);
  const publications = data.publications.filter((p) => !p.revoked);
  return (
    <section
      data-operator-workbench
      className="delivery-ops detail-card"
      ref={formRootRef}
      onChangeCapture={onChangeCapture}
      onResetCapture={onResetCapture}
    >
      <h2>Client and programme delivery</h2>
      <OperatorWorkbench
        label="Publication and reporting sections"
        sections={[
          { label: 'Programmes', heading: 'Create programme' },
          { label: 'Participants', heading: 'Participants' },
          { label: 'Publication', heading: 'Review client publication' },
          { label: 'Private scope', heading: 'Share approved view' },
          { label: 'Access and requests', heading: 'Access and requests' },
        ]}
      />
      <p>
        {realCustomerInput()
          ? 'Create a programme, review every intake row, then share only approved mission information. Use the participant contact details supplied for this work.'
          : 'Create a programme, review every intake row, then share only approved mission information. This is a sample workspace, so participant addresses must be made up and end in .invalid.'}
      </p>
      <p role="status" aria-label="Delivery status">
        {message}
      </p>
      <button disabled={busy} onClick={() => void act(async () => {})}>
        Refresh delivery
      </button>
      <label className="operator-select-field">
        Programme
        <select
          disabled={busy}
          aria-label="Programme"
          value={programme}
          onChange={(e) => {
            if (!confirmChange()) return;
            setProgramme(e.target.value);
            setSelected([]);
            setPreview(null);
            setResult(null);
            setPrivateLink('');
          }}
        >
          <option value="">All programmes / independent client missions</option>
          {data.programmes.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <p className="operator-pager">
        Programmes {Math.min(offset + 1, data.programmeTotal)} to{' '}
        {Math.min(offset + 100, data.programmeTotal)} of {data.programmeTotal}{' '}
        <button
          disabled={offset === 0 || busy}
          onClick={() => setOffset((v) => Math.max(0, v - 100))}
        >
          Previous programmes
        </button>{' '}
        <button
          disabled={offset + 100 >= data.programmeTotal || busy}
          onClick={() => setOffset((v) => v + 100)}
        >
          Next programmes
        </button>
      </p>
      {manages && (
        <details>
          <summary>Create programme</summary>
          <form className="operator-form" onSubmit={createProgramme}>
            <label>
              Programme name
              <input name="name" minLength={3} maxLength={160} required />
            </label>
            <label>
              Reporting purpose
              <textarea name="reportingPurpose" minLength={10} maxLength={500} required />
            </label>
            <button disabled={busy}>Create programme</button>
          </form>
        </details>
      )}
      {programme && (
        <>
          <h3>Participants</h3>
          <p>{data.participants.length} participants in this programme</p>
          <ul>
            {data.participants.map((p) => (
              <li key={p.id}>
                {p.reference}: {p.company} · {p.status.toLowerCase().replaceAll('_', ' ')}{' '}
                <button onClick={() => setMissionId(p.mission_id)}>Review mission</button>
              </li>
            ))}
          </ul>
          {manages && (
            <details open>
              <summary>Import participants</summary>
              <p>
                Maximum 100 rows and 1 MiB per file, 1000 participants per programme. XLSX must have
                one visible worksheet with text cells, no formulas or macros. Missing optional
                fields default to attendance “Not decided”, timezone “Asia/Dhaka”, outcome “Relevant
                meetings”, and empty dates, website and notes. Multiple outcomes use a | separator.
              </p>
              <a href={`${endpoint}&template=true`}>Download intake template</a>
              <form className="operator-form" onSubmit={upload}>
                <label>
                  CSV or Excel intake
                  <input
                    name="file"
                    type="file"
                    accept=".csv,.xlsx"
                    required
                    onChange={() => {
                      uploadKey.current = '';
                      setPreview(null);
                      setResult(null);
                    }}
                  />
                </label>
                <button disabled={busy}>Preview intake</button>
              </form>
              {preview && (
                <>
                  <p>
                    Preview expires {formatDateTime(preview.expiresAt)}. Ready{' '}
                    {preview.counts.ready}, duplicates {preview.counts.duplicates}, empty{' '}
                    {preview.counts.empty}, errors {preview.counts.errors}. All{' '}
                    {preview.counts.total} rows are shown below.
                  </p>
                  <div className="delivery-table">
                    <table>
                      <caption>Intake preview: every row</caption>
                      <thead>
                        <tr>
                          <th>Row</th>
                          <th>Reference</th>
                          <th>Company</th>
                          <th>Result</th>
                          <th>Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.rows.map((r) => (
                          <tr key={r.row}>
                            <td>{r.row}</td>
                            <td>{r.reference || 'Empty'}</td>
                            <td>{r.brief?.company ?? ''}</td>
                            <td>{r.status.toLowerCase().replaceAll('_', ' ')}</td>
                            <td>{r.errors.join('; ')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!result && (
                    <form className="operator-form" onSubmit={confirm}>
                      <label>
                        Mission owner
                        <select name="ownerId" required>
                          {data.owners.map((o) => (
                            <option key={o.user_id} value={o.user_id}>
                              {o.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <input name="acknowledged" type="checkbox" required /> I reviewed every row
                        and the exact ready, duplicate and empty counts. The accepted requests are
                        self-declarations.
                      </label>
                      <button disabled={busy || !!preview.counts.errors}>Confirm intake</button>
                    </form>
                  )}
                  {result && (
                    <ul aria-label="Confirmed intake results">
                      {result.map((r) => (
                        <li key={r.row}>
                          Row {r.row}: {r.reference || 'Empty'} · {r.result.toLowerCase()}{' '}
                          {r.missionId && (
                            <button onClick={() => setMissionId(r.missionId!)}>
                              Review imported mission
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </details>
          )}
        </>
      )}
      {shares && (
        <details>
          <summary>Review client publication</summary>
          <label>
            Mission
            <select value={missionId} onChange={(e) => setMissionId(e.target.value)}>
              <option value="">Choose mission</option>
              {[
                ...data.participants.map((p) => ({ id: p.mission_id, company: p.company })),
                ...missions.filter((m) => !data.participants.some((p) => p.mission_id === m.id)),
              ].map((m) => (
                <option key={m.id} value={m.id}>
                  {m.company} · {m.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <p className="operator-pager">
            <button
              disabled={missionOffset === 0 || busy}
              onClick={() => setMissionOffset((v) => Math.max(0, v - 100))}
            >
              Previous missions
            </button>{' '}
            <button
              disabled={missionOffset + 100 >= missionTotal || busy}
              onClick={() => setMissionOffset((v) => v + 100)}
            >
              Next missions
            </button>
          </p>
          {missionId && (
            <form
              key={`${missionId}:${publicationDraft.restored}`}
              className="operator-form"
              onSubmit={publish}
              onChange={(e) => {
                const values = Object.fromEntries(
                  [...new FormData(e.currentTarget)].filter(
                    ([k, v]) =>
                      typeof v === 'string' && !['approved', 'meeting', 'opportunity'].includes(k),
                  ),
                ) as Record<string, string>;
                publicationDraft.save(values);
              }}
            >
              {publicationDraft.draft && (
                <p role="note">Your unsent draft for this mission was restored.</p>
              )}
              <p>Filled in from the mission. Check every line before you approve it.</p>
              <label>
                Client title
                <input
                  name="title"
                  minLength={3}
                  maxLength={160}
                  required
                  defaultValue={
                    publicationDraft.draft?.title ??
                    (chosen ? `${chosen.company}: progress update` : '')
                  }
                />
              </label>
              <label>
                Approved company name
                <input
                  name="company"
                  minLength={2}
                  maxLength={160}
                  required
                  defaultValue={publicationDraft.draft?.company ?? chosen?.company ?? ''}
                />
              </label>
              <label>
                Approved objective
                <textarea
                  name="objective"
                  minLength={3}
                  maxLength={500}
                  required
                  defaultValue={publicationDraft.draft?.objective ?? chosen?.objective ?? ''}
                />
              </label>
              <label>
                Approved request
                <textarea
                  name="brief"
                  minLength={10}
                  maxLength={2000}
                  required
                  defaultValue={publicationDraft.draft?.brief ?? chosen?.offer ?? ''}
                />
              </label>
              <label>
                Client next action
                <textarea
                  name="nextAction"
                  minLength={3}
                  maxLength={300}
                  required
                  defaultValue={publicationDraft.draft?.nextAction ?? chosen?.nextAction ?? ''}
                />
              </label>
              <DueField
                label="Next action deadline"
                name="dueAt"
                initial={publicationDraft.draft?.dueAt || chosen?.dueAt || weekAhead()}
              />
              <fieldset>
                <legend>Approve itinerary meetings</legend>
                {meetings.length === 0 && <p>No available meetings for this mission.</p>}
                {meetings.map((m) => (
                  <div key={m.id}>
                    <label>
                      <input type="checkbox" name="meeting" value={m.id} /> {m.title} ·{' '}
                      {plainStatus(m.status)} ·{' '}
                      {m.starts_at ? formatDateTime(m.starts_at) : 'Unscheduled'} ·{' '}
                      {m.location ?? 'Location not set'}
                    </label>
                    <label>
                      Client meeting label
                      <input
                        name={`meeting-label-${m.id}`}
                        defaultValue={m.title}
                        minLength={3}
                        maxLength={160}
                      />
                    </label>
                  </div>
                ))}
              </fieldset>
              <fieldset>
                <legend>Approve outcome scope</legend>
                {opportunities.map((o) => (
                  <label key={o.id}>
                    <input type="checkbox" name="opportunity" value={o.id} /> {o.title} ·{' '}
                    {plainStatus(o.status)}
                  </label>
                ))}
                <label>
                  <input type="checkbox" name="includeFinancials" /> Approve aggregate contracts,
                  invoices and confirmed cash in the selected scope, by currency
                </label>
              </fieldset>
              <label className="check-field">
                <input name="approved" type="checkbox" required /> I reviewed this copy and scope
                for external delivery. It excludes private contacts, notes, margins and
                negotiations.
              </label>
              <button disabled={busy || optionsMission !== missionId}>Approve publication</button>
            </form>
          )}
        </details>
      )}
      {shares && (
        <details>
          <summary>Share approved view</summary>
          <p>
            Sharing and evidence requests require a fresh authenticator check. Links are private
            bearer access: share them only with their intended recipients.
          </p>
          <fieldset>
            <legend>Approved publications</legend>
            {publications.map((p) => (
              <label key={p.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(p.id)}
                  onChange={(e) =>
                    setSelected((v) =>
                      e.target.checked ? [...v, p.id] : v.filter((id) => id !== p.id),
                    )
                  }
                />{' '}
                {p.copy.company}: {p.copy.title}
              </label>
            ))}
          </fieldset>
          <form className="operator-form" onSubmit={share}>
            <label>
              Audience
              <select value={audience} onChange={(e) => setAudience(e.target.value)}>
                <option value="CLIENT_PROGRESS">Client: one mission</option>
                <option value="INSTITUTION_REPORT">Institution: selected programme scope</option>
              </select>
            </label>
            <label>
              Approved sharing purpose
              <textarea
                key={programme}
                name="purpose"
                defaultValue={data.programmes.find((p) => p.id === programme)?.reporting_purpose}
                minLength={10}
                maxLength={500}
                required
              />
            </label>
            <DueField label="Link expiry (within 30 days)" name="expiresAt" initial={weekAhead()} />
            {audience === 'INSTITUTION_REPORT' && (
              <label>
                <input name="allowExport" type="checkbox" /> Allow CSV and PDF reports for this
                reporting purpose
              </label>
            )}
            {audience === 'INSTITUTION_REPORT' && (
              <label className="check-field">
                <input type="checkbox" name="includeDelegation" />
                Include the reviewed delegation context and agenda. Every disclosed meeting must
                already be explicitly approved in the selected participant publications.
              </label>
            )}
            <label className="check-field">
              <input name="approved" type="checkbox" required /> I approve this audience, purpose
              and exact publication scope.
            </label>
            <button
              disabled={
                busy || selected.length === 0 || (audience === 'INSTITUTION_REPORT' && !programme)
              }
            >
              Create private link
            </button>
          </form>
          {privateLink && (
            <p>
              Share this reviewed link:{' '}
              <a href={privateLink} target="_blank" rel="noopener noreferrer">
                Open approved view
              </a>
              {signInNeeded && (
                <span role="note">
                  {' '}
                  Public report links for live workspaces are switched off on the owner page, so for
                  a live workspace the customer opens this link after signing in to their Corridra
                  account and saving it under Saved missions. Sample workspace links open without
                  signing in.
                </span>
              )}
              <label>
                Private link
                <input readOnly value={privateLink} onFocus={(e) => e.currentTarget.select()} />
              </label>
            </p>
          )}
        </details>
      )}
      <h3>Access and requests</h3>
      <ul>
        {data.links.map((l) => (
          <li key={l.id}>
            {l.audience.toLowerCase().replaceAll('_', ' ')} · {l.reporting_purpose} · Expires{' '}
            {formatDateTime(l.expires_at)} · {l.revoked ? 'Revoked' : 'Issued'}
            {manages && !l.revoked && (
              <button
                data-intent="destructive"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await action('revoke', {
                      linkId: l.id,
                      publicationId: null,
                      reason: 'Operator withdrew delivery access',
                    });
                  })
                }
              >
                Revoke link
              </button>
            )}
          </li>
        ))}
      </ul>
      {manages && (
        <ul>
          {publications.map((p) => (
            <li key={p.id}>
              {p.copy.company}: {p.copy.title}{' '}
              <button
                data-intent="destructive"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await action('revoke', {
                      linkId: null,
                      publicationId: p.id,
                      reason: 'Operator withdrew reviewed publication',
                    });
                  })
                }
              >
                Withdraw publication
              </button>
            </li>
          ))}
        </ul>
      )}
      {shares && (
        <details>
          <summary>Create evidence request</summary>
          <form className="operator-form" onSubmit={evidenceRequest}>
            <label>
              Publication
              <select name="publicationId" required>
                {publications.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.copy.company}: {p.copy.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Request owner
              <select name="ownerId" required>
                {data.owners.map((o) => (
                  <option key={o.user_id} value={o.user_id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Request title
              <input name="title" minLength={3} maxLength={160} required />
            </label>
            <label>
              Approved instructions
              <textarea name="instructions" minLength={10} maxLength={1000} required />
            </label>
            <DueField label="Response deadline" name="dueAt" initial={weekAhead()} />
            <button disabled={busy}>Create request</button>
          </form>
        </details>
      )}
      <ul>
        {data.requests.map((r) => (
          <li key={r.id}>
            <strong>{r.title}</strong> · {r.status.toLowerCase()}
            <p>{r.instructions}</p>
            {r.response && <p>Self-declared response: {r.response}</p>}
            {manages && !['COMPLETED', 'CANCELLED'].includes(r.status) && (
              <>
                <button
                  disabled={busy || r.status !== 'RESPONDED'}
                  onClick={() =>
                    void act(async () => {
                      await action('closeRequest', {
                        requestId: r.id,
                        status: 'COMPLETED',
                        reason: 'Declaration received; evidence verification remains separate',
                      });
                    })
                  }
                >
                  Mark fulfilled
                </button>{' '}
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await action('closeRequest', {
                        requestId: r.id,
                        status: 'CANCELLED',
                        reason: 'Operator cancelled evidence request',
                      });
                    })
                  }
                >
                  Cancel request
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <PhoneFold summary="Mission and delegation experience: context, agenda and recipient scope">
        <DeliveryExperience
          role={data?.role ?? ''}
          key={`${tenant}:${programme}:${missionId}`}
          tenant={tenant}
          programme={programme}
          mission={missionId}
          participants={data?.participants ?? []}
          publications={data?.publications ?? []}
          owners={data?.owners ?? []}
        />
      </PhoneFold>
    </section>
  );
}
/** A required date and time field that shows its time zone and submits an exact instant (CQ-76, UX-04). */
function DueField({ label, name, initial }: { label: string; name: string; initial: string }) {
  const [value, setValue] = useState<string | null>(initial);
  return <DateTimeInput label={label} name={name} value={value} onChange={setValue} required />;
}
function plainStatus(code: string) {
  const words = code.replaceAll('_', ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
