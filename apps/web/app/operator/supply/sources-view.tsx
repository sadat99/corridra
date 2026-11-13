'use client';
import { useRef, useState, type FormEvent } from 'react';
import { EmptyState } from '../../../components/ux/empty-state';
import { ActionFeedback, useActionFeedback } from '../../../components/ux/feedback';
import { ReferencePicker } from '../../../components/ux/reference-picker';
import { formatDate } from '../../../lib/ux/format';
import {
  canWrite,
  refusalWords,
  sourceKindWords,
  sourceStatusWords,
  supplyGet,
  supplyPost,
} from '../../../lib/supply-screens';
import {
  DeniedNote,
  Loading,
  PausedNotice,
  ReadFailure,
  StepHeading,
  useLoad,
  useScreenState,
} from './supply-ui';

type Source = {
  id: string;
  kind: string;
  versionId: string;
  version: number;
  status: string;
  label: string;
  sourceRecordId: string | null;
  defaultRetentionMonths: number;
  agreementEndsAt: string | null;
  reason: string;
};
type Version = {
  id: string;
  version: number;
  status: string;
  reason: string;
  createdAt: string;
};

const lockedKinds: [string, string, string][] = [
  [
    'partner_organisation',
    'Partner Organisation',
    "Locked. Partner sources are not open yet. They need an agreement on record and the owner's approval.",
  ],
  [
    'partner_person',
    'Partner Person',
    "Locked. Partner sources are not open yet. They need an agreement on record and the owner's approval.",
  ],
  [
    'data_platform',
    'Data Platform',
    "Locked. Data platform sources are not open yet. They need an agreement, an approved connection and the owner's approval.",
  ],
];

// Pause, resume and retire are one command with another status.
const changes: Record<string, [string, string][]> = {
  active: [
    ['paused', 'Pause Source'],
    ['retired', 'Retire Source'],
  ],
  paused: [
    ['active', 'Resume Source'],
    ['retired', 'Retire Source'],
  ],
};

function Versions({ tenant, source }: { tenant: string; source: Source }) {
  const [open, setOpen] = useState(false);
  const versions = useLoad<{ versions: Version[] }>(
    () =>
      open
        ? supplyGet(tenant, 'source-versions', { source: source.id })
        : Promise.resolve({ versions: [] }),
    `${source.id}:${source.version}:${open}`,
  );
  return (
    <details
      className="research-history"
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>Versions ({source.version})</summary>
      {open && versions.loading ? <Loading words="Loading sources." /> : null}
      {open && versions.error ? (
        <ReadFailure error={versions.error} onRetry={versions.reload} />
      ) : null}
      <ul>
        {versions.data?.versions.map((version) => (
          <li key={version.id}>
            Version {version.version}, {sourceStatusWords[version.status] ?? version.status}.
            Reason: {version.reason}. Changed {formatDate(version.createdAt)}.
          </li>
        ))}
      </ul>
    </details>
  );
}

function SourceRow({
  tenant,
  source,
  writable,
  paused,
  onChanged,
}: {
  tenant: string;
  source: Source;
  writable: boolean;
  paused: boolean;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState<[string, string] | null>(null);
  const [busy, setBusy] = useState(false);
  const feedback = useActionFeedback();
  const commandId = useRef(crypto.randomUUID());
  const choices = writable ? (changes[source.status] ?? []) : [];
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending || busy || paused) return;
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim();
    setBusy(true);
    try {
      await supplyPost(tenant, 'source-version', {
        commandId: commandId.current,
        sourceId: source.id,
        expectedVersion: source.version,
        status: pending[0],
        label: source.label,
        sourceRecordId: source.sourceRecordId ?? undefined,
        defaultRetentionMonths: source.defaultRetentionMonths,
        agreementEndsAt: source.agreementEndsAt ?? undefined,
        reason,
      });
      commandId.current = crypto.randomUUID();
      setPending(null);
      onChanged();
    } catch (failure) {
      feedback.error(failure instanceof Error ? failure.message : 'The source was not changed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="supply-item">
      <p className="supply-item-title">
        <strong dir="auto">{source.label}</strong>{' '}
        <span className="ux-badge">{sourceStatusWords[source.status] ?? source.status}</span>
      </p>
      <dl className="supply-facts">
        <div>
          <dt>Kind</dt>
          <dd>{sourceKindWords[source.kind] ?? source.kind}</dd>
        </div>
        <div>
          <dt>Version</dt>
          <dd>{source.version}</dd>
        </div>
        <div>
          <dt>Keep Records For</dt>
          <dd>{source.defaultRetentionMonths} months</dd>
        </div>
      </dl>
      {choices.length > 0 && !pending ? (
        <div className="operator-toolbar">
          {choices.map((choice) => (
            <button
              key={choice[0]}
              type="button"
              className="text-link"
              onClick={() => setPending(choice)}
            >
              {choice[1]}
            </button>
          ))}
        </div>
      ) : null}
      {pending ? (
        <form className="operator-form" onSubmit={send}>
          <label className="field">
            Reason (3 to 160 characters)
            <input name="reason" required minLength={3} maxLength={160} />
          </label>
          {paused ? <p className="supply-quiet">{refusalWords.paused}</p> : null}
          <div className="operator-toolbar">
            <button className="primary-link" aria-disabled={busy || paused}>
              {pending[1]}
            </button>
            <button type="button" className="text-link" onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      <ActionFeedback
        scope={`source-${source.id}`}
        feedback={feedback.feedback}
        onClear={feedback.clear}
      />
      <Versions tenant={tenant} source={source} />
    </li>
  );
}

function SourceForm({
  tenant,
  paused,
  onCreated,
}: {
  tenant: string;
  paused: boolean;
  onCreated: () => void;
}) {
  const [step, setStep] = useState(1);
  const [kind, setKind] = useState('staff_research');
  const [record, setRecord] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const feedback = useActionFeedback();
  const commandId = useRef(crypto.randomUUID());
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Enter in the first step means Next, not Create Source.
    if (step === 1) {
      setStep(2);
      return;
    }
    if (busy || paused) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await supplyPost(tenant, 'create-source', {
        commandId: commandId.current,
        kind,
        status: 'active',
        label: String(form.get('label') ?? '').trim(),
        sourceRecordId: record ?? undefined,
        defaultRetentionMonths: Number(form.get('months') ?? 12),
        reason: 'Created by staff',
      });
      commandId.current = crypto.randomUUID();
      feedback.success('Source created. It is active and can be used now.');
      setStep(1);
      setRecord(null);
      onCreated();
    } catch (failure) {
      feedback.error(
        `The source was not saved. Your entries are still here. ${failure instanceof Error ? failure.message : ''}`.trim(),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="supply-disclosure">
      <summary>New Source</summary>
      <form className="operator-form" onSubmit={send}>
        <p className="supply-quiet">Step {step} of 2</p>
        <div hidden={step !== 1}>
          <StepHeading step={step}>What kind of source is this?</StepHeading>
          <fieldset className="supply-choices">
            <legend>Source kind</legend>
            <label className="supply-choice">
              <input
                type="radio"
                name="kind"
                value="staff_research"
                checked={kind === 'staff_research'}
                onChange={() => setKind('staff_research')}
              />
              <span>Staff Research</span>
            </label>
            <p className="supply-quiet">
              Corridra staff read public sources and write down what they find. No agreement is
              needed.
            </p>
            {lockedKinds.map(([value, label, reason]) => (
              <div key={value}>
                <label className="supply-choice">
                  <input
                    type="radio"
                    name="kind"
                    value={value}
                    disabled
                    aria-describedby={`why-${value}`}
                  />
                  <span>{label}</span>
                </label>
                <p id={`why-${value}`} className="supply-quiet">
                  {reason}
                </p>
              </div>
            ))}
          </fieldset>
          <button type="button" className="primary-link" onClick={() => setStep(2)}>
            Next
          </button>
        </div>
        <div hidden={step !== 2}>
          <StepHeading step={step}>Describe the source</StepHeading>
          <label className="field">
            Source label
            <input
              name="label"
              required={step === 2}
              minLength={3}
              maxLength={120}
              aria-describedby="source-label-hint"
            />
            <span id="source-label-hint" className="supply-quiet">
              Internal name, for example the website or register staff read.
            </span>
          </label>
          <ReferencePicker
            kind="source"
            tenant={tenant}
            label="Evidence record"
            hint="The record that shows where this source comes from."
            name="sourceRecordId"
            value={record}
            onChange={setRecord}
          />
          <label className="field">
            Keep records for (months)
            <input
              name="months"
              type="number"
              min={1}
              max={24}
              defaultValue={12}
              required={step === 2}
            />
            <span className="supply-quiet">
              Candidates from this source expire after this time, or earlier if the evidence record
              ends sooner.
            </span>
          </label>
          {paused ? <p className="supply-quiet">{refusalWords.paused}</p> : null}
          <div className="operator-toolbar">
            <button type="button" className="text-link" onClick={() => setStep(1)}>
              Back
            </button>
            <button className="primary-link" aria-disabled={busy || paused}>
              {busy ? 'Creating Source' : 'Create Source'}
            </button>
          </div>
        </div>
        <ActionFeedback scope="source-new" feedback={feedback.feedback} onClear={feedback.clear} />
      </form>
    </details>
  );
}

export function SourcesView({ tenant, role }: { tenant: string; role: string }) {
  const sources = useLoad<{ sources: Source[] }>(() => supplyGet(tenant, 'sources'), tenant);
  const screen = useScreenState(tenant);
  const writable = canWrite(role);
  const paused = screen.data ? !screen.data.moduleOpen : false;
  const [shown, setShown] = useState(5);
  const rows = sources.data?.sources ?? [];
  return (
    <section aria-labelledby="supply-sources-heading">
      <h2 id="supply-sources-heading">Sources</h2>
      <PausedNotice paused={paused} />
      {sources.loading && !sources.data ? <Loading words="Loading sources." /> : null}
      {sources.error ? <ReadFailure error={sources.error} onRetry={sources.reload} /> : null}
      {sources.data && rows.length === 0 ? (
        <EmptyState icon="company">
          No sources yet. Create a staff research source before adding candidates.
        </EmptyState>
      ) : null}
      <ul className="supply-list" aria-label="Supply sources">
        {rows.slice(0, shown).map((source) => (
          <SourceRow
            key={source.id}
            tenant={tenant}
            source={source}
            writable={writable}
            paused={paused}
            onChanged={sources.reload}
          />
        ))}
      </ul>
      {rows.length > shown ? (
        <div className="ux-show-more">
          <p role="status">
            Showing {shown} of {rows.length} sources.
          </p>
          <button type="button" className="text-link" onClick={() => setShown(shown + 5)}>
            Show More
          </button>
        </div>
      ) : null}
      {writable ? (
        <SourceForm tenant={tenant} paused={paused} onCreated={sources.reload} />
      ) : (
        <DeniedNote />
      )}
    </section>
  );
}
