'use client';
import { useRef, useState, type FormEvent } from 'react';
import { EmptyState } from '../../../components/ux/empty-state';
import { ActionFeedback, useActionFeedback } from '../../../components/ux/feedback';
import { formatDate } from '../../../lib/ux/format';
import { withStepUp } from '../../../lib/ux/step-up';
import { supplyListLimit } from '@corridra/domain/supply-sources';
import {
  canLift,
  canWrite,
  firstRows,
  listLimitWords,
  refusalWords,
  supplyGet,
  supplyPost,
} from '../../../lib/supply-screens';
import { CountryOptions } from '../country-options';
import { OrganisationPicker } from './organisation-picker';
import {
  DeniedNote,
  Loading,
  ReadFailure,
  StepHeading,
  useLoad,
  useScreenState,
} from './supply-ui';

type Block = {
  id: string;
  state: 'BLOCKED' | 'LIFTED';
  organisationId: string | null;
  organisationName: string | null;
  nameKey: string | null;
  country: string | null;
  reason: string;
  reference: string;
  at: string;
  by: string;
  current: boolean;
};
const subjectKey = (b: Block) => b.organisationId ?? `${b.nameKey ?? ''}:${b.country ?? ''}`;
/**
 * Lift Block and Block Again name the row they act on. The server reads the company from that row, so a name block is lifted
 * exactly as it was recorded; the name key held here is not a company name and must not be sent back as one.
 */
const subjectOf = (b: Block) => ({ blockId: b.id });
const label = (b: Block) => b.organisationName ?? b.nameKey ?? 'This company';

/** Lift Block and Block Again: one small form, Reason and Reference. A stale authenticator check asks again, entries kept. */
function SubjectForm({
  tenant,
  block,
  action,
  onDone,
  onCancel,
}: {
  tenant: string;
  block: Block;
  action: 'lift' | 'block';
  onDone: () => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const feedback = useActionFeedback();
  const commandId = useRef(crypto.randomUUID());
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await withStepUp(() =>
        supplyPost(tenant, action, {
          commandId: commandId.current,
          ...subjectOf(block),
          reason: String(data.get('reason') ?? '').trim(),
          reference: String(data.get('reference') ?? '').trim(),
        }),
      );
      commandId.current = crypto.randomUUID();
      onDone();
    } catch (failure) {
      feedback.error(failure instanceof Error ? failure.message : 'This entry was not saved.');
    } finally {
      setBusy(false);
    }
  }
  const text = action === 'lift' ? 'Lift Block' : 'Block Again';
  return (
    <form className="operator-form" onSubmit={send}>
      <label className="field">
        Reason
        <input name="reason" required minLength={3} maxLength={500} />
      </label>
      <label className="field">
        Reference
        <input name="reference" required minLength={3} maxLength={120} />
        <span className="supply-quiet">
          Use a case or ticket reference. Do not write a person&apos;s name or contact details.
        </span>
      </label>
      <div className="operator-toolbar">
        <button className="primary-link" aria-disabled={busy}>
          {busy ? 'Saving' : text}
        </button>
        <button type="button" className="text-link" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <ActionFeedback
        scope={`dnc-${block.id}`}
        feedback={feedback.feedback}
        onClear={feedback.clear}
      />
    </form>
  );
}

function BlockForm({ tenant, onDone }: { tenant: string; onDone: (text: string) => void }) {
  const [step, setStep] = useState(1);
  const [inCatalogue, setInCatalogue] = useState(true);
  const [organisation, setOrganisation] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const feedback = useActionFeedback();
  const commandId = useRef(crypto.randomUUID());
  const form = useRef<HTMLFormElement>(null);
  const [summary, setSummary] = useState('');
  function next() {
    const panel = form.current?.querySelector<HTMLElement>('[data-step="1"]');
    for (const field of Array.from(panel?.querySelectorAll<HTMLInputElement>('input,select') ?? []))
      if (!field.reportValidity()) return;
    if (inCatalogue && !organisation) {
      feedback.error('Choose a company from the catalogue, or pick "Not in the catalogue yet".');
      return;
    }
    feedback.clear();
    const data = new FormData(form.current ?? undefined);
    setSummary(inCatalogue ? name : String(data.get('companyName') ?? '').trim());
    setStep(2);
  }
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    // Enter in an early step means Next, not Block Company.
    if (step === 1) {
      next();
      return;
    }
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await supplyPost(tenant, 'block', {
        commandId: commandId.current,
        ...(inCatalogue
          ? { organisationId: organisation }
          : {
              companyName: String(data.get('companyName') ?? '').trim(),
              country: String(data.get('country') ?? ''),
            }),
        reason: String(data.get('reason') ?? '').trim(),
        reference: String(data.get('reference') ?? '').trim(),
      });
      commandId.current = crypto.randomUUID();
      onDone(`Blocked. ${summary} will be refused for new candidates, matches and introductions.`);
      form.current?.reset();
      setOrganisation(null);
      setStep(1);
    } catch (failure) {
      feedback.error(failure instanceof Error ? failure.message : 'The block was not saved.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="supply-disclosure">
      <summary>Block a Company</summary>
      <form ref={form} className="operator-form" onSubmit={send}>
        <p className="supply-quiet">Step {step} of 2</p>
        <div data-step="1" hidden={step !== 1}>
          <StepHeading step={step}>Which company?</StepHeading>
          <fieldset className="supply-choices">
            <legend>Company source</legend>
            <label className="supply-choice">
              <input
                type="radio"
                name="where"
                checked={inCatalogue}
                onChange={() => setInCatalogue(true)}
              />
              <span>Company in the catalogue</span>
            </label>
            <label className="supply-choice">
              <input
                type="radio"
                name="where"
                checked={!inCatalogue}
                onChange={() => setInCatalogue(false)}
              />
              <span>Not in the catalogue yet</span>
            </label>
          </fieldset>
          {inCatalogue ? (
            <OrganisationPicker
              tenant={tenant}
              label="Company in the catalogue"
              value={organisation}
              onChange={(value, text) => {
                setOrganisation(value);
                setName(text);
              }}
            />
          ) : (
            <>
              <label className="field">
                Company name
                <input name="companyName" required maxLength={160} dir="auto" />
              </label>
              <div className="field">
                <label htmlFor="dnc-country">Country</label>
                <select id="dnc-country" name="country" required defaultValue="">
                  <option value="" disabled>
                    Choose a country
                  </option>
                  <CountryOptions />
                </select>
              </div>
            </>
          )}
          <button type="button" className="primary-link" onClick={next}>
            Next
          </button>
        </div>
        <div data-step="2" hidden={step !== 2}>
          <StepHeading step={step}>Why?</StepHeading>
          <label className="field">
            Reason
            <input name="reason" required={step === 2} minLength={3} maxLength={500} />
          </label>
          <label className="field">
            Reference (3 to 120 characters)
            <input name="reference" required={step === 2} minLength={3} maxLength={120} />
            <span className="supply-quiet">
              Use a case or ticket reference. Do not write a person&apos;s name or contact details.
            </span>
          </label>
          <p>
            You are blocking {summary}. Candidates, matches and introductions for it will be refused
            until a block is lifted.
          </p>
          <div className="operator-toolbar">
            <button type="button" className="text-link" onClick={() => setStep(1)}>
              Back
            </button>
            <button className="primary-link" aria-disabled={busy}>
              {busy ? 'Saving' : 'Block Company'}
            </button>
          </div>
        </div>
        <ActionFeedback scope="dnc-new" feedback={feedback.feedback} onClear={feedback.clear} />
      </form>
    </details>
  );
}

export function DncPanel({ tenant, role }: { tenant: string; role: string }) {
  const blocks = useLoad<{ blocks: Block[] }>(() => supplyGet(tenant, 'blocks'), tenant);
  const screen = useScreenState(tenant);
  const paused = screen.data ? !screen.data.moduleOpen : false;
  const [acting, setActing] = useState<{ id: string; action: 'lift' | 'block' } | null>(null);
  const [shown, setShown] = useState<number>(firstRows.blocks);
  const feedback = useActionFeedback();
  const rows = blocks.data?.blocks ?? [];
  const current = rows.filter((row) => row.current);
  return (
    <section className="supply-flow" aria-labelledby="dnc-heading">
      <h2 id="dnc-heading" className="sr-only">
        Blocked companies
      </h2>
      <p className="supply-quiet">
        Companies Corridra must not contact. A block stops new candidates, matches and introductions
        for that company.
      </p>
      <p className="supply-quiet">Blocks already recorded still apply while supply is paused.</p>
      {paused ? (
        <p role="status" className="supply-notice">
          {refusalWords.paused}
        </p>
      ) : null}
      <ActionFeedback scope="dnc-list" feedback={feedback.feedback} onClear={feedback.clear} />
      {blocks.loading && !blocks.data ? <Loading words="Loading blocks." /> : null}
      {blocks.error ? <ReadFailure error={blocks.error} onRetry={blocks.reload} /> : null}
      {blocks.data && current.length === 0 ? (
        <EmptyState icon="shield">
          No blocks recorded. Add one if a company must not be contacted.
        </EmptyState>
      ) : null}
      <ul className="supply-list" aria-label="Do-not-contact entries">
        {current.slice(0, shown).map((row) => {
          const history = rows.filter((other) => subjectKey(other) === subjectKey(row));
          return (
            <li key={row.id} className="supply-item">
              <p className="supply-item-title">
                <strong dir="auto">{label(row)}</strong>{' '}
                <span className="ux-badge">{row.state === 'BLOCKED' ? 'Blocked' : 'Lifted'}</span>
              </p>
              <dl className="supply-facts">
                <div>
                  <dt>Reference</dt>
                  <dd>{row.reference}</dd>
                </div>
                <div>
                  <dt>Changed</dt>
                  <dd>{formatDate(row.at)}</dd>
                </div>
              </dl>
              {!row.organisationId ? (
                <p className="supply-quiet">
                  Not in the company catalogue yet. The block applies when candidates are added or
                  reviewed.
                </p>
              ) : null}
              {canWrite(role) && acting?.id !== row.id ? (
                row.state === 'BLOCKED' ? (
                  canLift(role) ? (
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => setActing({ id: row.id, action: 'lift' })}
                    >
                      Lift Block
                    </button>
                  ) : (
                    <p className="supply-quiet">Only an owner or admin can lift a block.</p>
                  )
                ) : (
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => setActing({ id: row.id, action: 'block' })}
                  >
                    Block Again
                  </button>
                )
              ) : null}
              {acting?.id === row.id ? (
                <SubjectForm
                  tenant={tenant}
                  block={row}
                  action={acting.action}
                  onCancel={() => setActing(null)}
                  onDone={() => {
                    feedback.success(
                      acting.action === 'lift' ? `Block lifted for ${label(row)}.` : 'Blocked.',
                    );
                    setActing(null);
                    blocks.reload();
                  }}
                />
              ) : null}
              <details className="research-history">
                <summary>History ({history.length})</summary>
                <ul>
                  {history.map((entry) => (
                    <li key={entry.id}>
                      {entry.state === 'BLOCKED' ? 'Blocked' : 'Lifted'}, {formatDate(entry.at)}.{' '}
                      {entry.reason}. Reference {entry.reference}.
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          );
        })}
      </ul>
      {current.length > shown ? (
        <div className="ux-show-more supply-more">
          <p role="status">
            Showing {shown} of {current.length} entries.
          </p>
          <button type="button" className="text-link" onClick={() => setShown(shown + 5)}>
            Show More
          </button>
        </div>
      ) : null}
      {rows.length >= supplyListLimit ? (
        <p className="supply-quiet supply-inline">{listLimitWords.blocks}</p>
      ) : null}
      {canWrite(role) ? (
        <BlockForm
          tenant={tenant}
          onDone={(text) => {
            feedback.success(text);
            blocks.reload();
          }}
        />
      ) : (
        <DeniedNote />
      )}
    </section>
  );
}
