'use client';
import { useState } from 'react';
import type { AgendaItem, MissionExperience } from '@corridra/delivery/report';
import { compareOffers } from '@corridra/domain/commercial-missions';
import { displayMoney, displayDate } from '@corridra/domain/locale';
const offerFieldLabels: Record<string, string> = {
  specification: 'Quoted specification',
  quantity: 'Quantity',
  moq: 'Minimum order quantity',
  unit: 'Quantity unit',
  unitPriceMinor: 'Original unit price',
  totalPriceMinor: 'Original total',
  toolingMinor: 'Tooling',
  setupMinor: 'Setup',
  packagingMinor: 'Packaging',
  leadTime: 'Lead time',
  validUntil: 'Offer valid until',
  incoterm: 'Incoterm',
  shipping: 'Shipping scope',
  warranty: 'Warranty',
  installation: 'Installation',
  training: 'Training',
  spares: 'Spares',
  paymentTerms: 'Payment terms',
};
export function AgendaView({
  agenda,
  language = 'en',
}: {
  agenda: AgendaItem[];
  language?: string;
}) {
  return agenda.length ? (
    <ul>
      {agenda.map((a) => (
        <li key={a.id}>
          <strong>{a.label}</strong> · {a.state.replaceAll('_', ' ').toLowerCase()}
          <p>
            {a.nextAction} · {a.responsibility} · due {displayDate(a.dueAt, 'UTC', language)}
          </p>
          {a.meetings.map((m) => (
            <p key={m.id}>
              {m.status.toLowerCase().replaceAll('_', ' ')}:{' '}
              {m.scheduleChanged
                ? 'Schedule changed. An updated review is required.'
                : m.startsAt
                  ? `${displayDate(m.startsAt, m.timezone ?? 'UTC', language)} · ${m.location ?? 'Location not supplied'}`
                  : 'No confirmed appointment time supplied.'}
            </p>
          ))}
        </li>
      ))}
    </ul>
  ) : (
    <p>No agenda activities have been approved for this view.</p>
  );
}
export function MissionExperienceView({ experience: e }: { experience: MissionExperience }) {
  const [language, setLanguage] = useState('en');
  const r = e.requirements;
  const comparisons = compareOffers(
    e.quotations.map((q) => ({
      id: q.id,
      currency: q.currency,
      terms: q.terms,
      requirementId: String(r?.version ?? 'missing'),
      uncertainties: q.uncertainties,
      evidenceCurrent:
        !!r?.current &&
        !q.superseded &&
        q.assignmentCurrent &&
        (!r.fields.specifications || r.fields.specifications === q.terms.specification) &&
        (!r.fields.quantity || r.fields.quantity === q.terms.quantity) &&
        (!r.fields.unit || r.fields.unit === q.terms.unit),
    })),
  );
  return (
    <section aria-label="Approved mission detail">
      <h3>Requirements and decisions</h3>
      <label>
        Date and number display
        <select value={language} onChange={(ev) => setLanguage(ev.target.value)}>
          <option value="en">English</option>
          <option value="bn-BD">বাংলা (dates and numbers)</option>
        </select>
      </label>
      <p>
        Business names and original text are retained. This control formats dates and numbers; it
        does not translate documents.
      </p>
      {r ? (
        <>
          <p>
            Requirement version {r.version} ·{' '}
            {r.current ? 'Current requirement' : 'Historical requirement; updated review needed'} ·{' '}
            {r.sourceKind} · {r.claimStatus}. No independent verification is asserted.
          </p>
          <dl>
            <dt>Objective</dt>
            <dd>{r.fields.objective}</dd>
            <dt>Product or equipment</dt>
            <dd>{r.fields.product}</dd>
            <dt>Specifications</dt>
            <dd>{r.fields.specifications ?? 'Not supplied'}</dd>
            <dt>Quantity</dt>
            <dd>
              {r.fields.quantity ? `${r.fields.quantity} ${r.fields.unit ?? ''}` : 'Not supplied'}
            </dd>
            <dt>Budget</dt>
            <dd>
              {r.fields.budgetMinor !== undefined && r.fields.currency
                ? `${displayMoney(r.fields.budgetMinor, r.fields.currency, language)} · ${r.fields.budgetBasis}`
                : 'Not supplied'}
            </dd>
          </dl>
          {r.fields.machinery && (
            <details>
              <summary>Technical requirements</summary>
              <dl>
                {Object.entries(r.fields.machinery).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k.replace(/([A-Z])/g, ' $1')}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </>
      ) : (
        <p>No structured requirement has been approved for this view.</p>
      )}
      {r && (
        <details>
          <summary>Complete approved requirement</summary>
          <dl>
            {Object.entries(r.fields)
              .filter(
                ([key]) =>
                  ![
                    'objective',
                    'product',
                    'specifications',
                    'quantity',
                    'unit',
                    'budgetMinor',
                    'currency',
                    'budgetBasis',
                    'machinery',
                  ].includes(key),
              )
              .map(([key, value]) => (
                <div key={key}>
                  <dt>
                    {(
                      {
                        role: 'Declared commercial role',
                        category: 'Product category',
                        targetMarkets: 'Target markets',
                        moq: 'Minimum order quantity',
                        orderFrequency: 'Order frequency',
                        materials: 'Materials',
                        dimensions: 'Dimensions',
                        technicalConstraints: 'Technical constraints',
                        certifications: 'Required certifications',
                        oemOdm: 'OEM / ODM requirement',
                        delivery: 'Delivery requirement',
                        leadTime: 'Lead-time requirement',
                        incoterm: 'Requested Incoterm',
                        requiredEvidence: 'Required evidence',
                        travelDates: 'Travel or activity timing',
                        decisionCriteria: 'Decision criteria',
                        responsiblePersons: 'Declared responsibilities',
                      } as Record<string, string>
                    )[key] ?? key}
                  </dt>
                  <dd>{Array.isArray(value) ? value.join('; ') : String(value)}</dd>
                </div>
              ))}
          </dl>
        </details>
      )}
      <h3>Target shortlist and fit</h3>
      {e.shortlist.length ? (
        e.shortlist.map((t) => (
          <article key={t.id}>
            <h4>
              <span lang={/\p{Script=Han}/u.test(t.company) ? 'zh' : undefined}>{t.company}</span> (
              {t.country})
            </h4>
            <p>
              {t.fit.toLowerCase()} · {t.rationale}
            </p>
            <p>Uncertainty: {t.uncertainty}</p>
            <p>Evidence gaps: {t.gaps}</p>
            <p className="evidence-label">{t.verification}</p>
          </article>
        ))
      ) : (
        <p>No target shortlist has been approved for this view.</p>
      )}
      <h3>Original quotations and comparison</h3>
      {e.quotations.length ? (
        e.quotations.map((q, index) => (
          <article key={q.id}>
            <h4>Supplier offer, revision {q.revision}</h4>
            <p>
              {e.shortlist.find((t) => t.id === q.targetId)?.company ?? 'Selected supplier'} ·{' '}
              {q.sourceKind} · {q.claimStatus}
            </p>
            <p>
              Original unit price:{' '}
              {q.terms.unitPriceMinor !== undefined
                ? displayMoney(q.terms.unitPriceMinor, q.currency, language)
                : 'NOT SUPPLIED'}
            </p>
            <p>
              Original total:{' '}
              {q.terms.totalPriceMinor !== undefined
                ? displayMoney(q.terms.totalPriceMinor, q.currency, language)
                : 'NOT SUPPLIED'}
            </p>
            <p>{q.uncertainties}</p>
            <details>
              <summary>Original offer terms</summary>
              <dl>
                {Object.entries(q.terms).map(([key, value]) => (
                  <div key={key}>
                    <dt>{offerFieldLabels[key] ?? key}</dt>
                    <dd>
                      {key.endsWith('Minor')
                        ? displayMoney(String(value), q.currency, language)
                        : key === 'validUntil'
                          ? displayDate(String(value), 'UTC', language)
                          : String(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
            <p className="evidence-label">
              {comparisons[index].status}.{' '}
              {comparisons[index].missing
                .map((k) => `${offerFieldLabels[k] ?? k}: NOT SUPPLIED`)
                .join('; ')}
            </p>
            {comparisons[index].derivedTotal && (
              <p>
                Unit price × quantity:{' '}
                {displayMoney(comparisons[index].derivedTotal!.amountMinor, q.currency, language)}.
                Other charges are separate; no FX conversion is used.
              </p>
            )}
          </article>
        ))
      ) : (
        <p>
          No quotation has been approved for this view. Confidential supplier offers are shared only
          by explicit selection.
        </p>
      )}
      <h3>Visits and owned actions</h3>
      <AgendaView agenda={e.agenda} language={language} />
      <p>{e.documentAccess}</p>
    </section>
  );
}
