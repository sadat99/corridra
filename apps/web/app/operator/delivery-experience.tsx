'use client';
import { CustomerMissionDelivery } from './customer-mission-delivery';
import { DecisionDisclosures } from './decision-disclosures';
import { CustomerServiceRequests } from './customer-service-requests';
import { CustomerBilling } from './customer-billing';
import { CustomerInvoicing } from './customer-invoicing';
import { OperatorWorkbench } from '../../components/operator-workbench';
import { useEffect, useState, type FormEvent } from 'react';
import { countryCodes } from '@corridra/domain/countries';
import { displayMoney } from '@corridra/domain/locale';
type Experience = {
  organisations: { id: string; name: string; source_id: string; claim_id: string }[];
  contexts: { version: number; details: { organiser: string; purpose: string } }[];
  agenda: {
    id: string;
    item_id: string;
    version: number;
    details: { label: string; state: string; nextAction: string; dueAt: string };
  }[];
  requirements: { id: string; version: number; fields: { product: string } }[];
  targets: { id: string; name: string }[];
  quotations: {
    id: string;
    target_id: string;
    currency: string;
    revision: number;
    uncertainties: string;
  }[];
  links: { id: string; company: string; mission_id: string }[];
  rfqs: { id: string; target_ids: string[] }[];
  disclosures: { link_id: string; role: string; shared_requirements: string }[];
  responses: {
    id: string;
    link_id: string;
    body: {
      body: string;
      meetingInterest: boolean;
      quotation: null | { currency: string; terms: Record<string, string>; uncertainties: string };
    };
    source_kind: string;
  }[];
};
type Props = {
  role: string;
  tenant: string;
  programme: string;
  mission: string;
  participants: { id: string; mission_id: string; company: string }[];
  publications: { id: string; mission_id: string; copy: { title: string }; revoked: boolean }[];
  owners: { user_id: string; name: string }[];
};
const fields = (f: HTMLFormElement) => new FormData(f);
const list = (d: FormData, key: string) => d.getAll(key).map(String);
const value = (d: FormData, k: string) => String(d.get(k) ?? '');
const instant = (d: FormData, k: string) => new Date(`${value(d, k)}Z`).toISOString();
export function DeliveryExperience(props: Props) {
  const { tenant, programme, mission, participants, publications, owners } = props;
  const [data, setData] = useState<Experience | null>(null),
    [meetings, setMeetings] = useState<
      { id: string; mission_id: string; title: string; status: string }[]
    >([]),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const endpoint = `/api/workspace/delivery?tenant=${encodeURIComponent(tenant)}`;
  async function load() {
    const r = await fetch(
        `${endpoint}&action=experience${programme ? `&programme=${programme}` : ''}${mission ? `&mission=${mission}` : ''}`,
        { cache: 'no-store' },
      ),
      v = await r.json();
    if (!r.ok) throw Error(v.error);
    setData(v);
  }
  useEffect(() => {
    let active = true;
    fetch(
      `${endpoint}&action=experience${programme ? `&programme=${programme}` : ''}${mission ? `&mission=${mission}` : ''}`,
      { cache: 'no-store' },
    )
      .then(async (r) => {
        const v = await r.json();
        if (!r.ok) throw Error(v.error);
        if (active) setData(v);
      })
      .catch((e) => {
        if (active) setMessage(e.message);
      });
    fetch(`/api/workspace/meetings?tenant=${encodeURIComponent(tenant)}`).then(async (r) => {
      const v = await r.json();
      if (r.ok && active) setMeetings(v.meetings ?? []);
    });
    return () => {
      active = false;
    };
  }, [endpoint, programme, mission, tenant]);
  async function submit(
    e: FormEvent<HTMLFormElement>,
    action: string,
    build: (d: FormData) => Record<string, unknown>,
  ) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setMessage('');
    try {
      const input = build(fields(form));
      const r = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, input: { commandId: crypto.randomUUID(), ...input } }),
        }),
        v = await r.json();
      if (!r.ok) throw Error(v.error);
      setMessage(
        'Recorded in this workspace. Client detail and recipient disclosures apply only to the explicitly approved publication or link.',
      );
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Please review the submitted scope.');
    } finally {
      setBusy(false);
    }
  }
  const owner = (
    <label className="field">
      Responsible operator
      <select name="ownerId" required>
        {owners.map((o) => (
          <option key={o.user_id} value={o.user_id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
  const reason = (
    <label className="field">
      Reason
      <input name="reason" minLength={3} maxLength={1000} required />
    </label>
  );
  if (!data) return <p role="status">{message || 'Loading scoped delivery options…'}</p>;
  return (
    <section data-operator-workbench className="detail-card">
      <h2>Mission and delegation experience</h2>
      <OperatorWorkbench
        label="Mission experience sections"
        sections={[
          { label: 'Delegation', heading: 'Delegation context' },
          { label: 'Agenda', heading: 'Shared and participant agenda' },
          { label: 'Participant detail', heading: 'Approve participant mission detail' },
          {
            label: 'Organisation attribution',
            heading: 'Explicit participant organisation attribution',
          },
          { label: 'Recipient scope', heading: 'Recipient role' },
        ]}
      />
      <p>
        Owner/admin and fresh MFA are required for participant identity, client-detail and recipient
        disclosures. Programme context and proposed agenda remain operational tasks.
      </p>
      <p role="status">{message}</p>
      {programme ? (
        <>
          <details>
            <summary>Delegation context</summary>
            <p>
              Keep shared context separate from each participant&apos;s private requirements and
              offers.
            </p>
            <form
              onSubmit={(e) =>
                void submit(e, 'context', (d) => ({
                  programmeId: programme,
                  version: (data.contexts[0]?.version ?? 0) + 1,
                  organiser: value(d, 'organiser'),
                  marketCode: value(d, 'marketCode'),
                  purpose: value(d, 'purpose'),
                  startsAt: instant(d, 'startsAt'),
                  endsAt: instant(d, 'endsAt'),
                  timezone: value(d, 'timezone'),
                  ownerId: value(d, 'ownerId'),
                  reason: value(d, 'reason'),
                }))
              }
            >
              {['organiser', 'purpose'].map((k) => (
                <label className="field" key={k}>
                  {k === 'organiser' ? 'Organiser' : 'Shared commercial purpose'}
                  <input name={k} minLength={3} maxLength={1000} required />
                </label>
              ))}
              <label className="field">
                Shared market
                <select name="marketCode" required>
                  <option value="EU">European Union (trade bloc)</option>
                  {countryCodes.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                Start (UTC)
                <input name="startsAt" type="datetime-local" required />
              </label>
              <label className="field">
                End (UTC)
                <input name="endsAt" type="datetime-local" required />
              </label>
              <label className="field">
                Display timezone
                <input name="timezone" placeholder="Asia/Shanghai" required />
              </label>
              {owner}
              {reason}
              <button disabled={busy}>Record delegation context</button>
            </form>
            {data.contexts.map((c) => (
              <p key={c.version}>
                Version {c.version}: {c.details.organiser} · {c.details.purpose}
              </p>
            ))}
          </details>
          <details>
            <summary>Shared and participant agenda</summary>
            <form
              onSubmit={(e) =>
                void submit(e, 'agenda', (d) => ({
                  programmeId: programme,
                  itemId: value(d, 'itemId') || crypto.randomUUID(),
                  version: Number(value(d, 'version')),
                  label: value(d, 'label'),
                  missionIds: list(d, 'missionIds'),
                  meetingIds: list(d, 'meetingIds'),
                  state: value(d, 'state'),
                  ownerId: value(d, 'ownerId'),
                  nextAction: value(d, 'nextAction'),
                  dueAt: instant(d, 'dueAt'),
                  reason: value(d, 'reason'),
                }))
              }
            >
              <label className="field">
                Agenda item label
                <input name="label" minLength={3} maxLength={1000} required />
              </label>
              <label className="field">
                Existing item ID (blank for new item)
                <input name="itemId" />
              </label>
              <label className="field">
                Version
                <input name="version" type="number" defaultValue={1} min={1} required />
              </label>
              <fieldset>
                <legend>Explicit participant scope</legend>
                {participants.map((p) => (
                  <label className="check-field" key={p.mission_id}>
                    <input type="checkbox" name="missionIds" value={p.mission_id} />
                    {p.company}
                  </label>
                ))}
              </fieldset>
              <fieldset>
                <legend>Actual meetings for those participants</legend>
                {meetings
                  .filter((m) => participants.some((p) => p.mission_id === m.mission_id))
                  .map((m) => (
                    <label className="check-field" key={m.id}>
                      <input type="checkbox" name="meetingIds" value={m.id} />
                      {m.title} · {m.status}
                    </label>
                  ))}
              </fieldset>
              <label className="field">
                Agenda state
                <select name="state">
                  <option>PROPOSED</option>
                  <option>CONFIRMED</option>
                  <option>CANCELLED</option>
                </select>
              </label>
              {owner}
              <label className="field">
                Next action
                <input name="nextAction" minLength={3} maxLength={1000} required />
              </label>
              <label className="field">
                Action due (UTC)
                <input name="dueAt" type="datetime-local" required />
              </label>
              {reason}
              <p>
                Confirmation requires an actual scheduled or held meeting for every selected
                participant. It never creates a booking.
              </p>
              <button disabled={busy}>Record scoped agenda item</button>
            </form>
            {data.agenda.map((a) => (
              <p key={a.id}>
                {a.details.label} · {a.details.state} · {a.details.nextAction} ·{' '}
                {new Date(a.details.dueAt) < new Date() ? 'Overdue' : 'Action scheduled'} · item{' '}
                {a.item_id}, version {a.version}
              </p>
            ))}
          </details>
        </>
      ) : (
        <p>Choose a programme above to configure its delegation context and agenda.</p>
      )}
      {mission ? (
        <details>
          <summary>Approve participant mission detail</summary>
          <p>
            Select the exact requirement, targets, original quotations and agenda records for this
            participant. Other participants and organisers do not receive this detail.
          </p>
          <form
            onSubmit={(e) =>
              void submit(e, 'experience-publication', (d) => ({
                publicationId: value(d, 'publicationId'),
                requirementId: value(d, 'requirementId') || null,
                targetIds: list(d, 'targetIds'),
                quotationIds: list(d, 'quotationIds'),
                agendaItemIds: list(d, 'agendaItemIds'),
                approved: true,
                reason: value(d, 'reason'),
              }))
            }
          >
            <label className="field">
              Existing reviewed publication
              <select name="publicationId" required>
                <option value="">Choose this mission&apos;s publication</option>
                {publications
                  .filter((p) => p.mission_id === mission && !p.revoked)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.copy.title}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              Requirement snapshot
              <select name="requirementId">
                <option value="">No requirement disclosure</option>
                {data.requirements.map((r) => (
                  <option key={r.id} value={r.id}>
                    Version {r.version}: {r.fields.product}
                  </option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend>Approved target shortlist</legend>
              {data.targets.map((t) => (
                <label className="check-field" key={t.id}>
                  <input name="targetIds" type="checkbox" value={t.id} />
                  {t.name}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>Explicitly approved quotations</legend>
              {data.quotations.map((q) => (
                <label className="check-field" key={q.id}>
                  <input name="quotationIds" type="checkbox" value={q.id} />
                  {data.targets.find((t) => t.id === q.target_id)?.name ?? 'Supplier'} ·{' '}
                  {q.currency} · revision {q.revision} · {q.uncertainties}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>Participant agenda records</legend>
              {data.agenda.map((a) => (
                <label className="check-field" key={a.id}>
                  <input name="agendaItemIds" type="checkbox" value={a.id} />
                  {a.details.label} · version {a.version}
                </label>
              ))}
            </fieldset>
            {reason}
            <label className="check-field">
              <input type="checkbox" required />I approve these exact records for this
              participant&apos;s client capability. This does not approve organiser access to
              quotations.
            </label>
            <button disabled={busy || !['owner', 'admin'].includes(props.role)}>
              Approve scoped mission detail
            </button>
          </form>
        </details>
      ) : (
        <p>Choose a mission above to review its requirements and quotation disclosure.</p>
      )}
      {programme && (
        <details>
          <summary>Explicit participant organisation attribution</summary>
          <p>
            Use an already source-reported company identity to count the same organisation once
            across missions. Matching names or email addresses never grant private access.
          </p>
          <form
            onSubmit={(e) =>
              void submit(e, 'participant-identity', (d) => ({
                participantId: value(d, 'participantId'),
                ...JSON.parse(value(d, 'identityReference')),
                approved: true,
                reason: value(d, 'reason'),
              }))
            }
          >
            <label className="field">
              Participant
              <select name="participantId" required>
                <option value="">Choose a participant</option>
                {participants.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.company}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Source-backed organisation
              <select name="identityReference" required>
                <option value="">Choose explicit public source and claim</option>
                {data.organisations.map((o) => (
                  <option
                    key={`${o.id}:${o.claim_id}`}
                    value={JSON.stringify({
                      organisationId: o.id,
                      sourceId: o.source_id,
                      claimId: o.claim_id,
                    })}
                  >
                    {o.name} · claim {o.claim_id}
                  </option>
                ))}
              </select>
            </label>
            {reason}
            <label className="check-field">
              <input type="checkbox" required />I reviewed this organisation attribution. It does
              not imply independent verification or workspace membership.
            </label>
            <button disabled={busy || !['owner', 'admin'].includes(props.role)}>
              Approve participant organisation
            </button>
          </form>
        </details>
      )}
      <details>
        <summary>Recipient role and explicitly shareable requirements</summary>
        <form
          onSubmit={(e) =>
            void submit(e, 'recipient-disclosure', (d) => ({
              linkId: value(d, 'linkId'),
              role: value(d, 'role'),
              sharedRequirements: value(d, 'sharedRequirements'),
              uncertainty: value(d, 'uncertainty'),
              rfqId: value(d, 'rfqId') || null,
              allowQuotation: d.get('allowQuotation') === 'on',
              allowMeetingInterest: d.get('allowMeetingInterest') === 'on',
              approved: true,
              reason: value(d, 'reason'),
            }))
          }
        >
          <label className="field">
            Existing recipient link
            <select name="linkId" required>
              <option value="">Choose an existing controlled introduction</option>
              {data.links.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.company} · {l.id}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Commercial role
            <select name="role">
              <option>BUYER</option>
              <option>SUPPLIER</option>
              <option>DISTRIBUTOR</option>
              <option>PARTNER</option>
            </select>
          </label>
          <label className="field">
            Explicitly shareable requirements
            <textarea name="sharedRequirements" minLength={3} maxLength={1000} required />
          </label>
          <label className="field">
            Disclosed uncertainty
            <textarea name="uncertainty" minLength={3} maxLength={1000} required />
          </label>
          <label className="field">
            Matching mission RFQ
            <select name="rfqId">
              <option value="">No RFQ disclosure</option>
              {data.rfqs.map((r) => (
                <option key={r.id}>{r.id}</option>
              ))}
            </select>
          </label>
          <label className="check-field">
            <input name="allowQuotation" type="checkbox" />
            Allow this supplier to record a self-declared quotation for the matching RFQ
          </label>
          <label className="check-field">
            <input name="allowMeetingInterest" type="checkbox" />
            Allow meeting/visit interest without confirming an appointment
          </label>
          {reason}
          <label className="check-field">
            <input type="checkbox" required />I reviewed this disclosure. No contact, unrelated
            quotation or raw document is included.
          </label>
          <button disabled={busy || !['owner', 'admin'].includes(props.role)}>
            Approve recipient disclosure
          </button>
        </form>
      </details>
      {['owner', 'admin'].includes(props.role) && (
        <DecisionDisclosures tenant={tenant} publications={publications} />
      )}
      {['owner', 'admin'].includes(props.role) && mission && (
        <CustomerMissionDelivery tenant={tenant} mission={mission} />
      )}
      {['owner', 'admin'].includes(props.role) && <CustomerServiceRequests tenant={tenant} />}
      {['owner', 'admin'].includes(props.role) && <CustomerBilling tenant={tenant} />}
      {['owner', 'admin'].includes(props.role) && <CustomerInvoicing tenant={tenant} />}
      <h3>Counterparty declarations awaiting review</h3>
      {data.responses.length ? (
        data.responses.map((r) => (
          <article key={r.id}>
            <p>{r.body.body}</p>
            <p className="evidence-label">
              {r.source_kind} · recipient link {r.link_id}. Review source and evidence before
              recording a mission quotation or confirming a meeting.
            </p>
            {r.body.quotation && (
              <p>
                Original offer:{' '}
                {r.body.quotation.terms.unitPriceMinor !== undefined
                  ? displayMoney(r.body.quotation.terms.unitPriceMinor, r.body.quotation.currency)
                  : 'NOT SUPPLIED'}{' '}
                · {r.body.quotation.uncertainties}
              </p>
            )}
            {r.body.meetingInterest && (
              <p>Meeting or visit interest expressed. No appointment inferred.</p>
            )}
          </article>
        ))
      ) : (
        <p>No detailed counterparty declarations have been received.</p>
      )}
    </section>
  );
}
