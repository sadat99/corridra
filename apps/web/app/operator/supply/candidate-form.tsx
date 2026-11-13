'use client';
import { useRef, useState, type FormEvent } from 'react';
import { ActionFeedback, useActionFeedback } from '../../../components/ux/feedback';
import { formatDate } from '../../../lib/ux/format';
import { refusalWords, sizeWords, supplyPost, typeWords } from '../../../lib/supply-screens';
import { CountryOptions } from '../country-options';
import type { ActiveSource } from './mission-candidates';
import { nameCheckWords } from './candidates-list';
import { PersonalDataLine, StepHeading } from './supply-ui';

const maxTypes = 8;

export function CandidateForm({
  tenant,
  missionId,
  profileVersionId,
  profileVersion,
  sources,
  paused,
  onAdded,
}: {
  tenant: string;
  missionId: string;
  profileVersionId: string;
  profileVersion: number;
  sources: ActiveSource[];
  paused: boolean;
  onAdded: () => void;
}) {
  const [step, setStep] = useState(1);
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? '');
  const [types, setTypes] = useState<string[]>([]);
  const [notSure, setNotSure] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<{ company: string; check: boolean } | null>(null);
  const [summary, setSummary] = useState('');
  const feedback = useActionFeedback();
  const commandId = useRef(crypto.randomUUID());
  const form = useRef<HTMLFormElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const source = sources.find((candidate) => candidate.id === sourceId) ?? sources[0];

  function next(from: number) {
    const panel = form.current?.querySelector<HTMLElement>(`[data-step="${from}"]`);
    const fields = Array.from(
      panel?.querySelectorAll<HTMLInputElement>('input,select,textarea') ?? [],
    );
    for (const field of fields) if (!field.reportValidity()) return;
    if (from === 2) {
      const data = new FormData(form.current ?? undefined);
      setSummary(
        `You are adding ${String(data.get('companyName') ?? '').trim()}, ${String(data.get('country') ?? '')}, as source-reported from ${source?.label ?? ''}, observed ${formatDate(String(data.get('observedAt') ?? ''))}.`,
      );
    }
    setStep(from + 1);
  }
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Enter in an early step means Next, not Add Candidate.
    if (step < 3) {
      next(step);
      return;
    }
    if (busy || paused || !source) return;
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? '').trim() || undefined;
    setBusy(true);
    feedback.clear();
    try {
      const result = await supplyPost<{ candidateId: string; warnings: string[] }>(
        tenant,
        'add-candidate',
        {
          commandId: commandId.current,
          missionId,
          profileVersionId,
          sourceVersionId: source.versionId,
          companyName: text('companyName'),
          country: text('country'),
          websiteHost: text('websiteHost'),
          publicIdentifier: text('publicIdentifier'),
          sizeBand: text('sizeBand'),
          counterpartyTypes: notSure ? [] : types,
          observedAt: `${text('observedAt')}T00:00:00Z`,
          sourceLocator: text('sourceLocator'),
          nominationNote: note.trim() || undefined,
        },
      );
      commandId.current = crypto.randomUUID();
      setAdded({
        company: text('companyName') ?? '',
        check: result.warnings.includes('personal_name_check'),
      });
      form.current?.reset();
      setTypes([]);
      setNotSure(false);
      setNote('');
      setStep(1);
      onAdded();
      window.setTimeout(() => status.current?.focus(), 0);
    } catch (failure) {
      feedback.error(failure instanceof Error ? failure.message : 'The candidate was not added.');
    } finally {
      setBusy(false);
    }
  }
  if (sources.length === 0)
    return (
      <p className="supply-quiet">No active source for this mission. Create or resume one first.</p>
    );
  return (
    <form ref={form} className="operator-form" onSubmit={send}>
      <p className="supply-quiet">
        Adding to source: {source?.label}, version {source?.version}. For profile version{' '}
        {profileVersion}.
      </p>
      {sources.length > 1 ? (
        <label className="field">
          Source
          <select value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
            {sources.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <PersonalDataLine />
      {added ? (
        <div>
          <p role="status" tabIndex={-1} ref={status}>
            Added. {added.company} is on the list and not yet reviewed.
            {added.check ? ' Name check raised. Look at the name before you qualify it.' : ''}
          </p>
          {added.check ? <p className="supply-quiet">{nameCheckWords}</p> : null}
          <button type="button" className="text-link" onClick={() => setAdded(null)}>
            Add Another Company
          </button>
        </div>
      ) : null}
      <p className="supply-quiet">Step {step} of 3</p>
      <div data-step="1" hidden={step !== 1 || added !== null}>
        <StepHeading step={step}>Which company is it?</StepHeading>
        <label className="field">
          Company name
          <input
            name="companyName"
            required
            maxLength={160}
            dir="auto"
            aria-describedby="cand-name-hint"
          />
          <span id="cand-name-hint" className="supply-quiet">
            As written by the source. No contact details.
          </span>
        </label>
        <div className="field">
          <label htmlFor="cand-country">Country</label>
          <select id="cand-country" name="country" required defaultValue="">
            <option value="" disabled>
              Choose a country
            </option>
            <CountryOptions />
          </select>
        </div>
        <label className="field">
          Website host
          <input
            name="websiteHost"
            maxLength={120}
            inputMode="url"
            aria-describedby="cand-host-hint"
          />
          <span id="cand-host-hint" className="supply-quiet">
            The host only, such as example.com. No https:// and no page path.
          </span>
        </label>
        <button type="button" className="primary-link" onClick={() => next(1)}>
          Next
        </button>
      </div>
      <div data-step="2" hidden={step !== 2 || added !== null}>
        <StepHeading step={step}>What do you know about it?</StepHeading>
        <label className="field">
          Public identifier
          <input name="publicIdentifier" maxLength={80} aria-describedby="cand-id-hint" />
          <span id="cand-id-hint" className="supply-quiet">
            A public registration or tax number of the company. Not a person&apos;s ID.
          </span>
        </label>
        <div className="field">
          <label htmlFor="cand-size">Size band</label>
          <select id="cand-size" name="sizeBand" defaultValue="">
            <option value="">Not known</option>
            {Object.entries(sizeWords).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="supply-choices">
          <legend>Company types</legend>
          <p className="supply-quiet" role="status">
            {notSure ? 0 : types.length} of {maxTypes} chosen
          </p>
          {Object.entries(typeWords).map(([value, label]) => (
            <label key={value} className="supply-choice">
              <input
                type="checkbox"
                checked={types.includes(value)}
                disabled={notSure || (!types.includes(value) && types.length >= maxTypes)}
                onChange={(event) =>
                  setTypes(
                    event.target.checked ? [...types, value] : types.filter((t) => t !== value),
                  )
                }
              />
              <span>{label}</span>
            </label>
          ))}
          <label className="supply-choice">
            <input
              type="checkbox"
              checked={notSure}
              onChange={(event) => {
                setNotSure(event.target.checked);
                if (event.target.checked) setTypes([]);
              }}
            />
            <span>Not sure yet</span>
          </label>
        </fieldset>
        <div className="operator-toolbar">
          <button type="button" className="text-link" onClick={() => setStep(1)}>
            Back
          </button>
          <button type="button" className="primary-link" onClick={() => next(2)}>
            Next
          </button>
        </div>
      </div>
      <div data-step="3" hidden={step !== 3 || added !== null}>
        <StepHeading step={step}>Where did you read it?</StepHeading>
        <label className="field">
          Observed date
          <input
            name="observedAt"
            type="date"
            required
            max={new Date().toISOString().slice(0, 10)}
            aria-describedby="cand-date-hint"
          />
          <span id="cand-date-hint" className="supply-quiet">
            The day you read it.
          </span>
        </label>
        <label className="field">
          Source locator
          <input name="sourceLocator" required maxLength={500} aria-describedby="cand-loc-hint" />
          <span id="cand-loc-hint" className="supply-quiet">
            The web address or document reference of the exact page.
          </span>
        </label>
        <label className="field">
          Internal note (optional)
          <textarea
            name="nominationNote"
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            aria-describedby="cand-note-hint"
          />
          <span id="cand-note-hint" className="supply-quiet">
            Staff only. Up to 500 characters. No names or contact details. Never shown to the
            seller.
          </span>
          <span className="supply-quiet" aria-live="polite">
            {note.length} of 500
          </span>
        </label>
        <p>{summary}</p>
        {paused ? <p className="supply-quiet">{refusalWords.paused}</p> : null}
        <div className="operator-toolbar">
          <button type="button" className="text-link" onClick={() => setStep(2)}>
            Back
          </button>
          <button className="primary-link" aria-disabled={busy || paused}>
            {busy ? 'Adding Candidate' : 'Add Candidate'}
          </button>
        </div>
      </div>
      <ActionFeedback scope="candidate-add" feedback={feedback.feedback} onClear={feedback.clear} />
    </form>
  );
}
