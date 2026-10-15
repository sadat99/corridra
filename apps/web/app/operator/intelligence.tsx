'use client';
import { OperatorWorkbench } from '../../components/operator-workbench';
import { StatusBadge } from '../../components/access-state';
import {
  SubmissionFailure,
  submissionMessage,
  useRetainedSubmission,
} from '../../components/retained-submission';
import { displayMoney } from '@corridra/domain/locale';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
const tasks = [
  'commercial_intent',
  'requirement_structuring',
  'counterparty_research',
  'entity_duplicate_suggestions',
  'buyer_supplier_fit',
  'machinery_specification',
  'quotation_comparison',
  'meeting_preparation',
  'translation',
  'evidence_gaps',
  'post_meeting_followup',
  'opportunity_outcome_summary',
];
type Draft = {
  run_id: string;
  result_id: string | null;
  task: string;
  status: string | null;
  decision: string | null;
  output: unknown;
  metadata: {
    model?: string;
    adapter?: string;
    estimatedMinor?: string;
    latencyMs?: number;
    promptVersion?: string;
  };
  edited_output: unknown;
};
type Snapshot = {
  enabled: boolean;
  policies: {
    id: string;
    key: string;
    version: number;
    configuration: { adapter: string; model: string };
  }[];
  drafts: Draft[];
};
export function GovernedAssistance({ tenant, role }: { tenant: string; role: string }) {
  const [data, setData] = useState<Snapshot | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [sources, setSources] = useState<unknown>(null);
  const request = useCallback(
    async (action: string, input?: unknown, run?: string) => {
      const r = await fetch(
        '/api/workspace/' +
          action +
          '?tenant=' +
          encodeURIComponent(tenant) +
          (run ? '&run=' + encodeURIComponent(run) : ''),
        input
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(input),
            }
          : { cache: 'no-store' },
      );
      const body = await r.json();
      if (!r.ok)
        throw new SubmissionFailure(
          body.error ?? 'The submission could not be confirmed.',
          r.status,
          r.headers.get('X-Corridra-Request-ID'),
        );
      return body;
    },
    [tenant],
  );
  const refresh = useCallback(async () => setData(await request('intelligence')), [request]);
  useEffect(() => {
    let live = true;
    request('intelligence')
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e) => {
        if (live) setMessage(e.message);
      });
    return () => {
      live = false;
    };
  }, [request]);
  const submit = useRetainedSubmission();
  async function act(action: string, input: unknown, form: HTMLFormElement) {
    setBusy(true);
    setMessage('');
    try {
      const result = await submit(form, action, input, async (operation, original) => {
        try {
          return await request(operation, original);
        } catch (error) {
          if (
            operation === 'ai-run' &&
            error instanceof SubmissionFailure &&
            [400, 403, 409, 413, 422].includes(error.status)
          ) {
            try {
              const snapshot: Snapshot = await request('intelligence');
              setData(snapshot);
              const runId = (original as { commandId: string }).commandId;
              if (snapshot.drafts.some((draft) => draft.run_id === runId))
                return {
                  message:
                    'Request recorded. Inspect its current status before preparing another draft; manual mission work remains available.',
                };
              // The existing service returns at most 100 joined run rows. Only a complete
              // authorized read can establish that this rejected request has no recorded intent.
              error.intentNotRecorded = snapshot.drafts.length < 100;
            } catch {
              // An unavailable or denied read cannot establish receipt or absence.
            }
          }
          throw error;
        }
      });
      setMessage(result.message ?? 'Saved for review.');
      try {
        await refresh();
      } catch {
        setMessage(
          'Review received. Refresh failed; refresh AI review instead of submitting the received review again.',
        );
      }
    } catch (e) {
      setMessage(submissionMessage(e, 'Review could not be saved', action === 'ai-run'));
    } finally {
      setBusy(false);
    }
  }
  function run(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const task = String(f.get('task'));
    void act(
      'ai-run',
      {
        commandId: crypto.randomUUID(),
        missionId: f.get('mission'),
        policyId: f.get('policy'),
        input: {
          task,
          schemaVersion: 1,
          claimIds: String(f.get('claims'))
            .split(',')
            .map((v) => v.trim()),
          ...(task === 'translation' ? { targetLanguage: f.get('language') } : {}),
        },
      },
      e.currentTarget,
    );
  }
  function review(e: FormEvent<HTMLFormElement>, draft: Draft) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const decision = String(f.get('decision'));
      void act(
        'ai-review',
        {
          commandId: crypto.randomUUID(),
          resultId: draft.result_id,
          decision,
          reason: f.get('reason'),
          ...(decision === 'EDIT' ? { editedOutput: JSON.parse(String(f.get('edited'))) } : {}),
        },
        e.currentTarget,
      );
    } catch {
      setMessage('Check the structured draft before saving the edit.');
    }
  }
  return (
    <section
      className="detail-card ux-governance-panel"
      data-operator-workbench
      aria-label="Governed AI review"
    >
      <h2>AI assistance and review</h2>
      <OperatorWorkbench
        label="AI review workflow sections"
        sections={[
          { label: 'Draft preparation', heading: 'Prepare a source-linked draft' },
          { label: 'Review recorded drafts', heading: 'Recorded draft reviews' },
          {
            label: 'Original sources and rights',
            heading: 'Authorized original source quotations and rights',
          },
        ]}
      />
      <p>
        Assistance produces source-linked drafts. Accepting a draft records your review. Apply
        changes separately through mission commands.
      </p>
      <p role="status" aria-live="polite">
        {message}
      </p>
      <div className="workspace-links">
        <button
          className="text-link"
          disabled={busy}
          onClick={() =>
            void refresh()
              .then(() => setMessage('Updated.'))
              .catch((e) => setMessage(e.message))
          }
        >
          Refresh AI review
        </button>
        <a href="#workspace-missions">Open missions</a>
        <a href="#workspace-sources">Open sources and claims</a>
        <a href="#workspace-authenticator">Verify current access</a>
      </div>
      {!data && (
        <p>
          {message
            ? 'This section could not be loaded. Refresh it or verify your current access.'
            : 'Loading reviewed workspace…'}
        </p>
      )}
      {data && !data.enabled && (
        <p>
          AI assistance is awaiting provider and policy activation. Existing manual work remains
          available. <a href="#workspace-missions">Continue with manual mission work</a>.
        </p>
      )}
      {data && !data.policies.length && (
        <p>
          No reviewed model policy is available. Ask a workspace owner to review the source rights
          and provider policy.{' '}
          {['owner', 'admin'].includes(role) && (
            <a href="#workspace-settings">Open owner policy settings</a>
          )}
          .
        </p>
      )}
      <h3>Prepare a source-linked draft</h3>
      <form className="operator-form" onSubmit={run}>
        <label className="field">
          Task
          <select name="task">
            {tasks.map((task) => (
              <option key={task} value={task}>
                {task.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Mission reference
          <input name="mission" required />
        </label>
        <label className="field">
          Reviewed model policy
          <select name="policy" required>
            <option value="">Choose an approved policy</option>
            {data?.policies.map((p) => (
              <option key={p.id} value={p.id}>
                {p.key} v{p.version} · {p.configuration.adapter} · {p.configuration.model}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Approved public claim references, separated by commas
          <input name="claims" required />
        </label>
        <label className="field">
          Translation language, when translating
          <input name="language" placeholder="bn" />
        </label>
        <button className="primary-link" disabled={busy || !data?.enabled}>
          Prepare a draft
        </button>
      </form>
      <h3>Recorded draft reviews</h3>
      {data && !data.drafts.length && (
        <p>
          No recorded drafts in this workspace. Continue manual mission work or prepare a draft only
          when its reviewed policy and source rights permit it.
        </p>
      )}
      {data?.drafts.map((draft, i) => (
        <article key={draft.result_id ?? `${draft.run_id}-${i}`}>
          <h3>{draft.task.replaceAll('_', ' ')}</h3>
          <p>
            {draft.status ?? 'Pending; continue manually'} · {draft.decision ?? 'Awaiting review'}
          </p>
          {draft.metadata && (
            <p>
              {draft.metadata.adapter} · {draft.metadata.model} · {draft.metadata.promptVersion} ·
              estimated{' '}
              {draft.metadata.estimatedMinor
                ? displayMoney(draft.metadata.estimatedMinor, 'USD')
                : 'cost unknown'}{' '}
              · {draft.metadata.latencyMs} ms
            </p>
          )}
          {draft.output !== null && draft.output !== undefined && (
            <>
              <StatusBadge tone="unknown">Unverified AI draft</StatusBadge>
              <pre
                className="ai-draft-preview"
                tabIndex={0}
                role="region"
                aria-label={`Original ${draft.task.replaceAll('_', ' ')} draft ${i + 1}`}
              >
                {JSON.stringify(draft.edited_output ?? draft.output, null, 2)}
              </pre>
              <button
                className="text-link"
                disabled={busy}
                onClick={() =>
                  void request('ai-sources', undefined, draft.run_id)
                    .then(setSources)
                    .catch((e) => setMessage(e.message))
                }
              >
                Inspect original sources
              </button>
              {!draft.decision && (
                <form className="operator-form" onSubmit={(e) => review(e, draft)}>
                  <label className="field">
                    Review decision
                    <select name="decision">
                      <option value="ACCEPT">Accept as reviewed draft</option>
                      <option value="EDIT">Edit the structured draft</option>
                      <option value="REJECT">Reject draft</option>
                    </select>
                  </label>
                  <details>
                    <summary>Edit structured proposal</summary>
                    <label className="field">
                      Draft including original source references
                      <textarea
                        name="edited"
                        defaultValue={JSON.stringify(draft.output, null, 2)}
                        maxLength={24000}
                      />
                    </label>
                  </details>
                  <label className="field">
                    Review reason
                    <input name="reason" required minLength={3} maxLength={500} />
                  </label>
                  <button className="primary-link" disabled={busy}>
                    Save human review
                  </button>
                </form>
              )}
            </>
          )}
        </article>
      ))}
      {sources !== null && (
        <details open>
          <summary>Authorized original source quotations and rights</summary>
          <pre
            className="ai-draft-preview"
            tabIndex={0}
            role="region"
            aria-label="Original source and rights data"
          >
            {JSON.stringify(sources, null, 2)}
          </pre>
          <button className="text-link" onClick={() => setSources(null)}>
            Close source inspection
          </button>
        </details>
      )}
    </section>
  );
}
