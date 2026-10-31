'use client';
import {
  OperatorWorkbench,
  useFormChangeGuard,
  formAcknowledged,
} from '../../components/operator-workbench';
import { useState, type FormEvent } from 'react';
import { machineryFields, missionCatalogue } from '@corridra/domain/commercial-missions';
import { parseMoney, formatMoney, currency } from '@corridra/domain/opportunities';
import { readJson, withStepUp } from '../../lib/ux/step-up';

type Row = { id: string; version: number; created_at: string; [key: string]: unknown };
type Snapshot = {
  role: string;
  mission: Row;
  assignments: Row[];
  requirements: Row[];
  assessments: Row[];
  rfqs: Row[];
  quotations: Row[];
  decisions: Row[];
  schedules: Row[];
  meetings: Row[];
  targets: { id: string; name: string }[];
  owners: { user_id: string; name: string }[];
  comparison: {
    id: string;
    currency: string;
    terms: Record<string, string>;
    missing: string[];
    status: string;
    uncertainties: string;
    derivedTotal: { amountMinor: string; scope: string; calculatedAt: string } | null;
  }[];
};
type Catalogue = { packs: Row[]; types: Row[]; requirements: Row[]; assessments: Row[] };
type Proof = {
  sources: { id: string; locator: string }[];
  claims: { id: string; source_id: string; statement: string }[];
};
const labels: Record<string, string> = {
  application: 'Purpose and application',
  capacity: 'Throughput and capacity',
  configuration: 'Machine configuration',
  inputOutput: 'Input and output specifications',
  utilities: 'Electricity, utilities and site prerequisites',
  integration: 'Compatibility and integration',
  documentation: 'Technical documentation',
  commissioning: 'Installation and commissioning',
  training: 'Training',
  acceptance: 'FAT, SAT and acceptance criteria',
  warrantySpares: 'Warranty and spares',
  support: 'After-sales support',
  installationReferences: 'Existing installation references',
  transport: 'Delivery and transport scope',
  risks: 'Unknowns and risk flags',
};
function labelFor(key: string) {
  return (
    labels[key] ??
    key
      .replaceAll('_', ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace('Minor', ' (minor units)')
  );
}
function Values({ value }: { value: unknown }) {
  if (Array.isArray(value))
    return (
      <ul>
        {value.map((v, i) => (
          <li key={i}>
            <Values value={v} />
          </li>
        ))}
      </ul>
    );
  if (value && typeof value === 'object')
    return (
      <dl>
        {Object.entries(value)
          .filter(
            ([key]) =>
              ![
                'id',
                'meetingId',
                'tenant_id',
                'created_by',
                'created_at',
                'classification',
                'purpose',
                'message_id',
                'target_id',
              ].includes(key),
          )
          .map(([key, v]) => (
            <div key={key}>
              <dt>{labelFor(key)}</dt>
              <dd>
                <Values value={v} />
              </dd>
            </div>
          ))}
      </dl>
    );
  return <span>{value === null || value === undefined ? 'NOT SUPPLIED' : String(value)}</span>;
}
const words = (v: FormData, k: string) => String(v.get(k) ?? '').trim();
const lines = (v: FormData, k: string) =>
  words(v, k)
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
const optional = (v: FormData, keys: string[]) =>
  Object.fromEntries(keys.filter((k) => words(v, k)).map((k) => [k, words(v, k)]));
function Field({
  name,
  label,
  required = false,
  defaultValue = '',
  multiline = false,
  maxLength = 1000,
}: {
  name: string;
  label: string;
  required?: boolean;
  defaultValue?: string;
  multiline?: boolean;
  maxLength?: number;
}) {
  return (
    <label className="field">
      {label}
      {multiline ? (
        <textarea
          name={name}
          required={required}
          defaultValue={defaultValue}
          maxLength={maxLength}
        />
      ) : (
        <input name={name} required={required} defaultValue={defaultValue} maxLength={1000} />
      )}
    </label>
  );
}
export function CommercialMission({
  tenant,
  missionId,
  onChanged,
}: {
  tenant: string;
  missionId: string;
  onChanged?: () => void;
}) {
  const {
    ref: formRootRef,
    onChangeCapture,
    onResetCapture,
    confirmChange,
  } = useFormChangeGuard<HTMLDivElement>();
  const [data, setData] = useState<Snapshot | null>(null),
    [catalogue, setCatalogue] = useState<Catalogue | null>(null),
    [proof, setProof] = useState<Proof | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [job, setJob] = useState('requirements'),
    [source, setSource] = useState(''),
    [target, setTarget] = useState(''),
    [selectedPack, setSelectedPack] = useState(''),
    [dates, setDates] = useState({ observedAt: '', dueAt: '' });
  // A save refused for a stale authenticator check re-verifies in place and retries once with the same
  // command id, so the form and its values stay as typed (CQ-67, CQ-75).
  async function request(action: string, body?: unknown) {
    const send = async () =>
      readJson<Snapshot & Catalogue & Proof>(
        await fetch(
          `/api/workspace/${action}?tenant=${encodeURIComponent(tenant)}&mission=${missionId}`,
          body === undefined
            ? {}
            : {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              },
        ),
      );
    return body === undefined ? send() : withStepUp(send);
  }
  async function load() {
    setDates({
      observedAt: new Date().toISOString(),
      dueAt: new Date(Date.now() + 86400000).toISOString(),
    });
    setBusy(true);
    try {
      const [s, c, p] = await Promise.all([
        request('commercial-mission'),
        request('mission-catalogue'),
        request('workspace'),
      ]);
      setData(s);
      setCatalogue(c);
      setProof(p);
      setMessage('');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Unable to load');
    } finally {
      setBusy(false);
    }
  }
  const assignment = data?.assignments[0],
    requirement = data?.requirements[0],
    typeKey = String(assignment?.type_key ?? ''),
    template = missionCatalogue.find((t) => t.key === typeKey);
  const config = assignment?.configuration as
    { requirements: string[]; assessments: string[]; currencies: string[] } | undefined;
  const requirementDefinition = catalogue?.requirements.find(
    (r) =>
      config?.requirements.includes(r.id) && (r.schema as { typeKey: string })?.typeKey === typeKey,
  );
  const assessmentDefinition = catalogue?.assessments.find(
    (r) =>
      config?.assessments.includes(r.id) && (r.schema as { typeKey: string })?.typeKey === typeKey,
  );
  const manage = data && ['owner', 'admin', 'operator'].includes(data.role);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!data) return;
    const form = e.currentTarget,
      f = new FormData(form),
      commandId = form.dataset.commandId ?? (form.dataset.commandId = crypto.randomUUID());
    setBusy(true);
    setMessage('');
    try {
      const base = { commandId, missionId, reason: words(f, 'reason') },
        provenance = { sourceId: source, claimId: words(f, 'claimId') };
      let action = 'commercial-mission',
        payload: unknown;
      if (job === 'route') {
        action = 'mission-route';
        payload = {
          id: commandId,
          missionId,
          packId: selectedPack,
          missionTypeId: words(f, 'missionTypeId'),
          version: (assignment?.version ?? 0) + 1,
          reason: base.reason,
        };
      } else if (job === 'requirements') {
        const fields: Record<string, unknown> = {
          objective: words(f, 'objective'),
          role: words(f, 'role'),
          product: words(f, 'product'),
          ...optional(f, [
            'category',
            'specifications',
            'quantity',
            'unit',
            'moq',
            'orderFrequency',
            'materials',
            'dimensions',
            'technicalConstraints',
            'oemOdm',
            'delivery',
            'leadTime',
            'incoterm',
            'travelDates',
            'budgetBasis',
          ]),
        };
        for (const k of [
          'requiredEvidence',
          'certifications',
          'decisionCriteria',
          'responsiblePersons',
          'targetMarkets',
        ])
          if (lines(f, k).length) fields[k] = lines(f, k);
        if (words(f, 'budget')) {
          fields.budgetMinor = parseMoney(words(f, 'budget'), currency.parse(words(f, 'currency')));
          fields.currency = words(f, 'currency');
        }
        if (typeKey === 'machinery_procurement')
          fields.machinery = optional(f, [...machineryFields]);
        payload = {
          ...base,
          ...provenance,
          action: job,
          assignmentId: assignment?.id,
          definitionId: requirementDefinition?.id,
          version: (requirement?.version ?? 0) + 1,
          schemaVersion: 1,
          declaration: words(f, 'declaration'),
          fields,
        };
      } else if (job === 'assessment') {
        payload = {
          ...base,
          ...provenance,
          action: job,
          requirementId: requirement?.id,
          definitionId: assessmentDefinition?.id,
          targetId: target,
          version:
            Math.max(
              0,
              ...data.assessments.filter((a) => a.target_id === target).map((a) => a.version),
            ) + 1,
          method: words(f, 'method'),
          observedAt: words(f, 'observedAt'),
          technicalResults: (
            (assessmentDefinition?.schema as { machineryFields: string[] } | undefined)
              ?.machineryFields ?? []
          ).map((field) => ({
            field,
            result: words(f, 'technical.' + field + '.result'),
            basis: words(f, 'technical.' + field + '.basis'),
          })),
          results: (
            (assessmentDefinition?.schema as { criteria: string[] } | undefined)?.criteria ?? [
              ...(template?.criteria ?? []),
              'evidence_completeness',
            ]
          ).map((k) => ({
            criterion: k,
            result: words(f, k + '.result'),
            requirement: words(f, k + '.requirement'),
            basis: words(f, k + '.basis'),
          })),
          unknowns: words(f, 'unknowns'),
          gaps: words(f, 'gaps'),
          rationale: words(f, 'rationale'),
        };
      } else if (job === 'rfq') {
        payload = {
          ...base,
          ...provenance,
          action: job,
          requirementId: requirement?.id,
          targetIds: f.getAll('targets'),
          buyerContext: words(f, 'buyerContext'),
          requestedTerms: words(f, 'requestedTerms'),
          dueAt: words(f, 'dueAt'),
        };
      } else if (job === 'quotation') {
        const rfqId = words(f, 'rfqId'),
          old = data.quotations.find((q) => q.rfq_id === rfqId && q.target_id === target);
        const terms: Record<string, string> = optional(f, [
          'specification',
          'quantity',
          'moq',
          'unit',
          'leadTime',
          'validUntil',
          'incoterm',
          'shipping',
          'warranty',
          'installation',
          'training',
          'spares',
          'paymentTerms',
        ]);
        for (const k of ['unitPrice', 'totalPrice', 'tooling', 'setup', 'packaging'])
          if (words(f, k))
            terms[k + 'Minor'] = parseMoney(words(f, k), currency.parse(words(f, 'currency')));
        payload = {
          ...base,
          ...provenance,
          action: job,
          rfqId,
          targetId: target,
          revision: old ? Number(old.revision) + 1 : 1,
          ...(old ? { previousId: old.id } : {}),
          currency: words(f, 'currency'),
          terms,
          uncertainties: words(f, 'uncertainties'),
          observedAt: words(f, 'observedAt'),
        };
      } else if (job === 'decision') {
        payload = {
          ...base,
          ...provenance,
          action: job,
          requirementId: requirement?.id,
          targetId: target,
          assessmentId: words(f, 'assessmentId'),
          ...(words(f, 'quotationId') ? { quotationId: words(f, 'quotationId') } : {}),
          decision: words(f, 'decision'),
          rationale: words(f, 'rationale'),
          nextAction: words(f, 'nextAction'),
          ownerId: words(f, 'ownerId'),
          dueAt: words(f, 'dueAt'),
        };
      } else if (job === 'activity') {
        action = 'meeting';
        payload = {
          commandId,
          action: 'proposeActivity',
          targetId: target,
          activityKind: words(f, 'activityKind'),
          context: {
            purpose: words(f, 'purpose'),
            checklist: lines(f, 'checklist'),
            evidenceRequests: lines(f, 'evidenceRequests'),
          },
          title: words(f, 'title'),
          brief: words(f, 'brief'),
          participants: lines(f, 'participants'),
          ownerId: words(f, 'ownerId'),
          nextAction: words(f, 'nextAction'),
          dueAt: words(f, 'dueAt'),
          reason: base.reason,
        };
      } else if (job === 'origin') {
        action = 'commercial-origin';
        payload = {
          id: commandId,
          missionId,
          targetId: target,
          kind: words(f, 'kind'),
          ...provenance,
          summary: words(f, 'summary'),
          reason: base.reason,
        };
      } else {
        const kind = words(f, 'scheduleKind'),
          meetingId = words(f, 'meetingId');
        const entries = [
          ...((data.schedules[0]?.entries as unknown[]) ?? []),
          {
            kind,
            label: words(f, 'label'),
            timezone: words(f, 'timezone'),
            note: words(f, 'note'),
            ...(kind === 'APPOINTMENT'
              ? { meetingId }
              : { ...optional(f, ['location', 'startsAt', 'endsAt']) }),
          },
        ];
        payload = {
          ...base,
          action: 'schedule',
          version: (data.schedules[0]?.version ?? 0) + 1,
          entries,
        };
      }
      await request(action, payload);
      delete form.dataset.commandId;
      formAcknowledged(form);
      setData(await request('commercial-mission'));
      onChanged?.();
      setMessage('Saved with source and decision history.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Unable to save');
    } finally {
      setBusy(false);
    }
  }
  const targetSelect = (
    <label className="field">
      Counterparty
      <select value={target} onChange={(e) => setTarget(e.target.value)} required>
        <option value="">Choose a mission target</option>
        {data?.targets.map((t) => (
          <option value={t.id} key={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </label>
  );
  const ownership = (
    <>
      <label className="field">
        Responsible operator
        <select name="ownerId" required>
          {data?.owners.map((o) => (
            <option key={o.user_id} value={o.user_id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      <Field name="nextAction" label="Next action" required />
      <Field name="dueAt" label="Due at, with UTC offset" required defaultValue={dates.dueAt} />
    </>
  );
  return (
    <div
      className="operator-section ux-commercial-workbench"
      data-operator-workbench
      ref={formRootRef}
      onChangeCapture={onChangeCapture}
      onResetCapture={onResetCapture}
    >
      <OperatorWorkbench
        label={`Requirements and offer sections for mission ${missionId}`}
        sections={[
          { label: 'Requirements', heading: 'Requirements' },
          { label: 'Original offers', heading: 'Original offers' },
          { label: 'Comparison', heading: 'Supplier comparison' },
          { label: 'History', heading: 'assessments' },
        ]}
      />
      <button type="button" className="text-link" disabled={busy} onClick={() => void load()}>
        Review requirements, offers and visits
      </button>
      <p role="status">{message}</p>
      {data && (
        <>
          <h4>Commercial mission execution</h4>
          <p>
            {assignment?.status === 'ASSIGNED'
              ? `${assignment.origin_market} → ${assignment.destination_market} · ${template?.label ?? typeKey}`
              : 'Route not classified. An owner must supply an available reviewed route pack.'}
          </p>
          <p>
            These records are operator observations. Assessments do not certify engineering,
            regulatory compliance or independent factory audits.
          </p>
          {requirement && (
            <details>
              <summary>Requirements, version {requirement.version}</summary>
              <p>{String(requirement.declaration)}</p>
              <dl>
                {Object.entries(requirement.fields as Record<string, unknown>).map(([k, v]) => (
                  <div key={k}>
                    <dt>{labelFor(k)}</dt>
                    <dd>
                      <Values value={v} />
                    </dd>
                  </div>
                ))}
              </dl>
              <p>
                Recorded by {String(requirement.created_by)} at {requirement.created_at}
              </p>
            </details>
          )}
          <h4>Supplier comparison</h4>
          {(assessmentDefinition?.schema as { machineryFields: string[] } | undefined)
            ?.machineryFields?.length ? (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <caption>Machinery observations against the current requirements</caption>
                <thead>
                  <tr>
                    <th>Technical question</th>
                    {data.assessments
                      .filter((a) => a.requirement_id === requirement?.id)
                      .filter(
                        (a, i, rows) => rows.findIndex((b) => b.target_id === a.target_id) === i,
                      )
                      .map((a) => (
                        <th key={a.id}>
                          {data.targets.find((t) => t.id === a.target_id)?.name ??
                            'Accessible target'}{' '}
                          · assessment {a.version}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {(
                    assessmentDefinition?.schema as { machineryFields: string[] }
                  ).machineryFields.map((field) => (
                    <tr key={field}>
                      <th scope="row">{labels[field] ?? field}</th>
                      {data.assessments
                        .filter((a) => a.requirement_id === requirement?.id)
                        .filter(
                          (a, i, rows) => rows.findIndex((b) => b.target_id === a.target_id) === i,
                        )
                        .map((a) => {
                          const result = (
                            a.technical_results as {
                              field: string;
                              result: string;
                              basis: string;
                            }[]
                          ).find((r) => r.field === field);
                          return (
                            <td key={a.id}>
                              {result?.result ?? 'NOT SUPPLIED'}
                              <br />
                              {result?.basis ?? 'No assessed evidence supplied'}
                            </td>
                          );
                        })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <p>
            Empty terms mean NOT SUPPLIED. Incomplete, expired or differently scoped offers are NOT
            COMPARABLE. A comparable scope does not establish supplier suitability.
          </p>
          {data.comparison.length ? (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <caption>Latest supplier quotations, original currencies</caption>
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th>Original unit price</th>
                    <th>Comparison</th>
                    <th>Uncertainty</th>
                  </tr>
                </thead>
                <tbody>
                  {data.comparison.map((o) => (
                    <tr key={o.id}>
                      <td>
                        {data.targets.find(
                          (t) => t.id === data.quotations.find((q) => q.id === o.id)?.target_id,
                        )?.name ?? 'Unavailable target'}
                      </td>
                      <td>
                        {o.terms.unitPriceMinor
                          ? formatMoney(o.terms.unitPriceMinor, currency.parse(o.currency))
                          : 'NOT SUPPLIED'}
                      </td>
                      <td>
                        {o.status}
                        <br />
                        {o.missing.join(', ')}
                      </td>
                      <td>
                        {o.uncertainties}
                        <details>
                          <summary>Terms and calculation basis</summary>
                          <dl>
                            {[
                              'specification',
                              'quantity',
                              'moq',
                              'unit',
                              'unitPriceMinor',
                              'totalPriceMinor',
                              'toolingMinor',
                              'setupMinor',
                              'packagingMinor',
                              'leadTime',
                              'validUntil',
                              'incoterm',
                              'shipping',
                              'warranty',
                              'installation',
                              'training',
                              'spares',
                              'paymentTerms',
                            ].map((k) => (
                              <div key={k}>
                                <dt>{labelFor(k)}</dt>
                                <dd>{o.terms[k] ?? 'NOT SUPPLIED'}</dd>
                              </div>
                            ))}
                          </dl>
                          {o.derivedTotal && (
                            <p>
                              {formatMoney(o.derivedTotal.amountMinor, currency.parse(o.currency))}{' '}
                              derived from unit price × quantity at {o.derivedTotal.calculatedAt}.{' '}
                              {o.derivedTotal.scope}
                            </p>
                          )}
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No supplier offers recorded.</p>
          )}
          <details>
            <summary>Original offers and revision history ({data.quotations.length})</summary>
            {data.quotations.map((q) => (
              <div key={q.id}>
                <p>
                  {data.targets.find((t) => t.id === q.target_id)?.name ?? 'Accessible supplier'} ·
                  revision {String(q.revision)} · {String(q.currency)} · {q.created_at}
                </p>
                <p>
                  {String(q.reason)}. Source:{' '}
                  {proof?.sources.find((s) => s.id === q.source_id)?.locator ??
                    'Retained source reference'}
                </p>
                <Values value={q.terms} />
                <p>Uncertainty: {String(q.uncertainties)}</p>
              </div>
            ))}
          </details>
          {['assessments', 'decisions', 'schedules'].map((k) => (
            <details key={k}>
              <summary>
                {k} ({data[k as 'assessments'].length})
              </summary>
              {data[k as 'assessments'].map((r) => (
                <div key={r.id}>
                  <p>
                    {String(r.rationale ?? r.reason)} · {r.created_at}
                  </p>
                  <Values
                    value={
                      r.results ?? r.entries ?? { decision: r.decision, nextAction: r.next_action }
                    }
                  />
                  {k === 'assessments' && <Values value={r.technical_results} />}
                  {k === 'assessments' && (
                    <Values
                      value={{
                        method: r.method,
                        unknowns: r.unknowns,
                        gaps: r.gaps,
                        observedAt: r.observed_at,
                        responsibleAssessor:
                          data.owners.find((o) => o.user_id === r.created_by)?.name ??
                          'Recorded operator',
                      }}
                    />
                  )}
                </div>
              ))}
            </details>
          ))}
          {manage && (
            <>
              <label className="field">
                Next task
                <select
                  disabled={busy}
                  value={job}
                  onChange={(e) => {
                    if (busy || !confirmChange()) return;
                    setJob(e.target.value);
                    setMessage('');
                  }}
                >
                  {[
                    ['requirements', 'Review requirements'],
                    ['assessment', 'Assess a counterparty'],
                    ['rfq', 'Prepare an RFQ'],
                    ['quotation', 'Record a supplier offer'],
                    ['decision', 'Record selection or decline'],
                    ['activity', 'Propose a meeting or visit'],
                    ['schedule', 'Add a trip schedule item'],
                    ['origin', 'Record commercial opportunity origin'],
                    ...(data.role === 'owner' ? [['route', 'Assign a reviewed route']] : []),
                  ].map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <form className="operator-form" key={job} onSubmit={submit}>
                {job === 'route' ? (
                  <>
                    <label className="field">
                      Available route
                      <select
                        value={selectedPack}
                        onChange={(e) => setSelectedPack(e.target.value)}
                        required
                      >
                        <option value="">Choose a route</option>
                        {catalogue?.packs
                          .filter((p) =>
                            ['TESTING', 'LIMITED', 'ACTIVE'].includes(String(p.status)),
                          )
                          .map((p) => (
                            <option value={p.id} key={p.id}>
                              {String(p.origin_market)} → {String(p.destination_market)} · version{' '}
                              {p.version}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="field">
                      Mission job
                      <select name="missionTypeId" required>
                        {catalogue?.types
                          .filter((t) =>
                            (
                              catalogue.packs.find((p) => p.id === selectedPack)?.configuration as {
                                missionTypes: string[];
                              }
                            )?.missionTypes.includes(String(t.key)),
                          )
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {String(t.description)} · version {t.version}
                            </option>
                          ))}
                      </select>
                    </label>
                  </>
                ) : null}
                {!['route', 'schedule', 'activity'].includes(job) && (
                  <>
                    <label className="field">
                      Declared source
                      <select value={source} onChange={(e) => setSource(e.target.value)} required>
                        <option value="">Choose an existing source</option>
                        {proof?.sources.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.locator}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      Source declaration
                      <select name="claimId" required>
                        <option value="">Choose a matching claim</option>
                        {proof?.claims
                          .filter((c) => c.source_id === source)
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.statement}
                            </option>
                          ))}
                      </select>
                    </label>
                  </>
                )}
                {['assessment', 'quotation', 'decision', 'activity', 'origin'].includes(job) &&
                  targetSelect}
                {job === 'requirements' && (
                  <>
                    <Field
                      name="declaration"
                      label="Original customer declaration"
                      required
                      multiline
                      maxLength={2000}
                      defaultValue={String((data.mission.brief as { offer: string })?.offer ?? '')}
                    />
                    <Field name="objective" label="Commercial objective" required />
                    <label className="field">
                      Commercial role
                      <select name="role">
                        {[
                          'EXPORTER',
                          'IMPORTER',
                          'BUYER',
                          'SUPPLIER',
                          'INSTITUTION',
                          'OPERATOR',
                        ].map((r) => (
                          <option key={r}>{r}</option>
                        ))}
                      </select>
                    </label>
                    <Field name="product" label="Product or service" required />
                    <details>
                      <summary>Add specifications, budget or evidence needs</summary>
                      {[
                        'category',
                        'specifications',
                        'quantity',
                        'unit',
                        'moq',
                        'orderFrequency',
                        'materials',
                        'dimensions',
                        'technicalConstraints',
                        'oemOdm',
                        'delivery',
                        'leadTime',
                        'incoterm',
                        'travelDates',
                        'budgetBasis',
                      ].map((k) => (
                        <Field name={k} label={labelFor(k)} key={k} />
                      ))}
                      <Field name="budget" label="Target budget, original currency" />
                      <label className="field">
                        Budget currency
                        <select name="currency">
                          <option value="">Not supplied</option>
                          {config?.currencies.map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                      </label>
                      {[
                        'requiredEvidence',
                        'certifications',
                        'decisionCriteria',
                        'responsiblePersons',
                        'targetMarkets',
                      ].map((k) => (
                        <Field name={k} label={labelFor(k) + ' (one per line)'} key={k} multiline />
                      ))}
                    </details>
                    {typeKey === 'machinery_procurement' && (
                      <details>
                        <summary>Machine technical requirements</summary>
                        {machineryFields.map((k) => (
                          <Field name={k} key={k} label={labels[k]} multiline />
                        ))}
                      </details>
                    )}
                  </>
                )}
                {job === 'assessment' && (
                  <>
                    <Field
                      name="method"
                      label="Assessment method and version"
                      required
                      defaultValue="Operator review v1"
                    />
                    <Field
                      name="observedAt"
                      label="Assessment date, with UTC offset"
                      required
                      defaultValue={dates.observedAt}
                    />
                    {(
                      (assessmentDefinition?.schema as { criteria: string[] } | undefined)
                        ?.criteria ?? [...(template?.criteria ?? []), 'evidence_completeness']
                    ).map((k) => (
                      <fieldset key={k}>
                        <legend>{k.replaceAll('_', ' ')}</legend>
                        <Field name={k + '.requirement'} label="Requirement assessed" required />
                        <label className="field">
                          Result
                          <select name={k + '.result'}>
                            {['UNKNOWN', 'FIT', 'GAP', 'UNSUITABLE'].map((s) => (
                              <option key={s}>{s}</option>
                            ))}
                          </select>
                        </label>
                        <Field name={k + '.basis'} label="Evidence or declared basis" required />
                      </fieldset>
                    ))}
                    {['unknowns', 'gaps', 'rationale'].map((k) => (
                      <Field name={k} key={k} label={labelFor(k)} required multiline />
                    ))}
                    {(
                      (assessmentDefinition?.schema as { machineryFields: string[] } | undefined)
                        ?.machineryFields ?? []
                    ).map((field) => (
                      <fieldset key={field}>
                        <legend>{labels[field] ?? field}</legend>
                        <label className="field">
                          Technical result
                          <select name={'technical.' + field + '.result'}>
                            {['UNKNOWN', 'FIT', 'GAP', 'UNSUITABLE'].map((v) => (
                              <option key={v}>{v}</option>
                            ))}
                          </select>
                        </label>
                        <Field
                          name={'technical.' + field + '.basis'}
                          label="Technical evidence or missing information"
                          required
                          defaultValue="Not assessed; no evidence reviewed"
                          multiline
                        />
                      </fieldset>
                    ))}
                  </>
                )}
                {job === 'rfq' && (
                  <>
                    <fieldset>
                      <legend>Requested suppliers</legend>
                      {data.targets.map((t) => (
                        <label key={t.id}>
                          <input type="checkbox" name="targets" value={t.id} />
                          {t.name}
                        </label>
                      ))}
                    </fieldset>
                    <Field
                      name="buyerContext"
                      label="Buyer relationship and request context"
                      required
                    />
                    <Field
                      name="requestedTerms"
                      label="Required specification and quotation terms"
                      required
                      multiline
                    />
                    <Field
                      name="dueAt"
                      label="RFQ due at, with UTC offset"
                      required
                      defaultValue={dates.dueAt}
                    />
                  </>
                )}
                {job === 'quotation' && (
                  <>
                    <label className="field">
                      RFQ
                      <select name="rfqId" required>
                        <option value="">Choose an RFQ</option>
                        {data.rfqs.map((r) => (
                          <option key={r.id} value={r.id}>
                            {String(r.buyer_context)} · {r.created_at}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      Original currency
                      <select name="currency" required>
                        {config?.currencies.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </label>
                    <Field
                      name="observedAt"
                      label="Offer observed at, with UTC offset"
                      required
                      defaultValue={dates.observedAt}
                    />
                    {[
                      'specification',
                      'quantity',
                      'moq',
                      'unit',
                      'unitPrice',
                      'totalPrice',
                      'tooling',
                      'setup',
                      'packaging',
                      'leadTime',
                      'validUntil',
                      'incoterm',
                      'warranty',
                      'installation',
                      'training',
                      'spares',
                      'paymentTerms',
                    ].map((k) => (
                      <Field
                        key={k}
                        name={k}
                        label={
                          k +
                          (['unitPrice', 'totalPrice', 'tooling', 'setup', 'packaging'].includes(k)
                            ? ' (original currency amount)'
                            : '')
                        }
                      />
                    ))}
                    <label className="field">
                      Shipping scope
                      <select name="shipping">
                        {['NOT_SUPPLIED', 'INCLUDED', 'EXCLUDED'].map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </label>
                    <Field name="uncertainties" label="Explicit uncertainties" required multiline />
                  </>
                )}
                {job === 'decision' && (
                  <>
                    <label className="field">
                      Assessment
                      <select name="assessmentId" required>
                        {data.assessments
                          .filter((a) => a.target_id === target)
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              Version {a.version}: {String(a.rationale)}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="field">
                      Supplier offer
                      <select name="quotationId">
                        <option value="">No offer used</option>
                        {data.quotations
                          .filter((q) => q.target_id === target)
                          .map((q) => (
                            <option key={q.id} value={q.id}>
                              Revision {String(q.revision)}: {String(q.currency)} · {q.created_at}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="field">
                      Decision
                      <select name="decision">
                        {['NEED_INFORMATION', 'SELECT', 'DECLINE'].map((k) => (
                          <option key={k}>{k}</option>
                        ))}
                      </select>
                    </label>
                    <Field
                      name="rationale"
                      label="Decision rationale and remaining risk"
                      required
                      multiline
                    />
                    {ownership}
                  </>
                )}
                {job === 'activity' && (
                  <>
                    <label className="field">
                      Activity
                      <select name="activityKind">
                        {[
                          'BUYER_MEETING',
                          'SUPPLIER_MEETING',
                          'FACTORY_VISIT',
                          'SHOWROOM_VISIT',
                          'TECHNICAL_EVALUATION',
                          'INSTITUTIONAL_MEETING',
                          'TRADE_FAIR_MEETING',
                        ].map((k) => (
                          <option key={k}>{k}</option>
                        ))}
                      </select>
                    </label>
                    {[
                      'title',
                      'purpose',
                      'brief',
                      'participants',
                      'checklist',
                      'evidenceRequests',
                    ].map((k) => (
                      <Field
                        key={k}
                        name={k}
                        label={
                          k +
                          (['participants', 'checklist', 'evidenceRequests'].includes(k)
                            ? ' (one per line)'
                            : '')
                        }
                        required={['title', 'purpose', 'brief', 'participants'].includes(k)}
                        multiline
                      />
                    ))}
                    {ownership}
                    <p>
                      Proposed only. Record acceptance, confirmed location, attendance and follow-up
                      in Introductions and meetings.
                    </p>
                  </>
                )}
                {job === 'schedule' && (
                  <>
                    <label className="field">
                      Schedule item
                      <select name="scheduleKind">
                        {[
                          'DESTINATION',
                          'EVENT',
                          'CANDIDATE',
                          'APPOINTMENT',
                          'AVAILABILITY',
                          'CONSTRAINT',
                          'LOGISTICS',
                        ].map((k) => (
                          <option key={k}>{k}</option>
                        ))}
                      </select>
                    </label>
                    {['label', 'location', 'timezone', 'startsAt', 'endsAt', 'note'].map((k) => (
                      <Field
                        key={k}
                        name={k}
                        label={labelFor(k)}
                        required={['label', 'timezone', 'note'].includes(k)}
                        defaultValue={k === 'timezone' ? 'Asia/Dhaka' : ''}
                      />
                    ))}
                    <label className="field">
                      Confirmed appointment, if applicable
                      <select name="meetingId">
                        <option value="">No confirmed appointment</option>
                        {data.meetings
                          .filter((m) => ['SCHEDULED', 'HELD'].includes(String(m.status)))
                          .map((m) => (
                            <option key={m.id} value={m.id}>
                              {String(m.title)} · {String(m.status)}
                            </option>
                          ))}
                      </select>
                    </label>
                    <p>
                      Appointment times and locations come from the confirmed meeting. Logistics are
                      references, with no booking or live journey-time estimates.
                    </p>
                  </>
                )}
                {job === 'origin' && (
                  <>
                    <label className="field">
                      Commercial observation
                      <select name="kind">
                        {[
                          'QUALIFIED_SOURCING_REQUIREMENT',
                          'DOCUMENTED_RFQ',
                          'SUPPLIER_RESPONSE',
                        ].map((k) => (
                          <option key={k}>{k}</option>
                        ))}
                      </select>
                    </label>
                    <Field name="summary" label="Observed commercial origin" required />
                    <p>
                      Create the opportunity from this observation in Commercial follow-through.
                    </p>
                  </>
                )}
                <Field name="reason" label="Reason for recording this change" required />
                <button
                  className="primary-link"
                  disabled={
                    busy ||
                    (job === 'requirements' && !requirementDefinition) ||
                    (job === 'assessment' && !assessmentDefinition)
                  }
                >
                  Save {job.replaceAll('_', ' ')}
                </button>
              </form>
            </>
          )}
        </>
      )}
    </div>
  );
}
