'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
type Profile = {
  id: string;
  principal_id: string;
  version: number;
  configuration: {
    alias: string;
    status: string;
    capabilities: string[];
    markets: string[];
    workCountries: string[];
  };
};
type Task = {
  id: string;
  version: number;
  status: string;
  reviewer_id: string;
  late_submission: boolean;
  history: {
    version: number;
    action: string;
    reason: string;
    details: { body?: string; rationale?: string };
  }[];
  configuration: {
    kind: string;
    instructions: string;
    market: string;
    workCountry: string;
    deadline: string;
    evidenceRequired: string;
    rewardRuleId: string | null;
  };
};
type Performance = {
  principal_id: string;
  task_kind: string;
  market: string;
  completed_reviewed_tasks: number;
  evidence_quality: string;
  timeliness: string;
  rationale: { taskId: string; rationale: string }[];
};
type Snapshot = {
  enabled: boolean;
  profiles: Profile[];
  tasks: Task[];
  performance: Performance[];
};
const taskKinds = [
  'supplier_research',
  'introductions',
  'factory_coordination',
  'price_checks',
  'interpreting',
  'translation',
  'samples',
  'followup',
  'site_support',
  'category_intelligence',
  'delegation_assistance',
];
const labels: Record<string, string> = {
  principalId: 'Invited principal reference',
  alias: 'Private working name',
  capabilities: 'Reviewed capabilities, separated by commas',
  markets: 'Market countries, separated by commas',
  workCountries: 'Reviewed work countries, separated by commas',
  languages: 'Languages, separated by commas',
  sectors: 'Sectors, separated by commas',
  eligibilitySourceId: 'Reviewed eligibility source reference',
  expiresAt: 'Access cutoff (ISO date and time)',
  missionId: 'Mission reference',
  routeAssignmentId: 'Current route assignment reference',
  market: 'Task market country',
  workCountry: 'Work country',
  location: 'Disclosed work location',
  language: 'Task language',
  sector: 'Task sector',
  instructions: 'Exact work to perform',
  deadline: 'Submission deadline (ISO date and time)',
  evidenceRequired: 'Evidence to submit',
  effort: 'Expected effort',
  dataHandling: 'Data handling terms',
  cancellationTerms: 'Cancellation terms',
  disputeTerms: 'Dispute terms',
  reviewerId: 'Independent reviewer principal reference',
  rewardRuleId: 'Disclosed reward rule reference, optional',
  reason: 'Review reason',
};
function Fields({ names }: { names: string[] }) {
  return (
    <>
      {names.map((name) => (
        <label className="field" key={name}>
          {labels[name] ?? name}
          <input
            name={name}
            required={name !== 'rewardRuleId'}
            maxLength={name === 'instructions' ? 2000 : 500}
          />
        </label>
      ))}
    </>
  );
}
export function ExecutionNetwork({ tenant, role }: { tenant: string; role: string }) {
  const [data, setData] = useState<Snapshot | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const admin = ['owner', 'admin'].includes(role);
  const request = useCallback(
    async (action: string, input?: unknown) => {
      const r = await fetch(
        '/api/workspace/' + action + '?tenant=' + encodeURIComponent(tenant),
        input
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(input),
            }
          : { cache: 'no-store' },
      );
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      return body;
    },
    [tenant],
  );
  useEffect(() => {
    let live = true;
    request('network')
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
  async function act(action: string, input: unknown) {
    setBusy(true);
    setMessage('');
    try {
      const result = await request(action, input);
      setData(await request('network'));
      setMessage(result.id ? `Saved reference: ${result.id}` : 'Saved.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Work could not be saved');
    } finally {
      setBusy(false);
    }
  }
  function createProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const list = (key: string) =>
      String(f.get(key))
        .split(',')
        .map((v) => v.trim());
    void act('network-profile', {
      id: crypto.randomUUID(),
      version: 1,
      principalId: f.get('principalId'),
      alias: f.get('alias'),
      categories: [f.get('category')],
      capabilities: list('capabilities'),
      markets: list('markets'),
      workCountries: list('workCountries'),
      languages: list('languages'),
      sectors: list('sectors'),
      eligibilitySourceId: f.get('eligibilitySourceId'),
      expiresAt: f.get('expiresAt'),
      available: true,
      status: 'ACTIVE',
      reason: f.get('reason'),
    });
  }
  function createTask(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const input: Record<string, unknown> = { id: crypto.randomUUID() };
    for (const name of [
      'missionId',
      'routeAssignmentId',
      'kind',
      'market',
      'workCountry',
      'location',
      'language',
      'sector',
      'instructions',
      'deadline',
      'expiresAt',
      'evidenceRequired',
      'effort',
      'dataHandling',
      'cancellationTerms',
      'disputeTerms',
      'reviewerId',
      'reason',
    ])
      input[name] = f.get(name);
    input.capabilities = String(f.get('capabilities'))
      .split(',')
      .map((v) => v.trim());
    input.rewardRuleId = f.get('rewardRuleId') || null;
    void act('network-task', input);
  }
  function taskEvent(e: FormEvent<HTMLFormElement>, task: Task) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      action = String(f.get('action'));
    void act('network-event', {
      commandId: crypto.randomUUID(),
      taskId: task.id,
      version: task.version,
      action,
      reason: f.get('reason'),
      details:
        action === 'ASSIGN'
          ? {
              kind: 'assignment',
              profileId: f.get('profileId'),
              relationshipDisclosure: f.get('relationshipDisclosure'),
            }
          : {
              kind: 'decision',
              ...(action === 'RESOLVE' ? { resolution: f.get('resolution') } : {}),
            },
    });
  }
  function review(e: FormEvent<HTMLFormElement>, task: Task) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void act('network-review', {
      commandId: crypto.randomUUID(),
      taskId: task.id,
      version: task.version,
      evidenceQuality: Number(f.get('quality')),
      timeliness: Number(f.get('timeliness')),
      rationale: f.get('rationale'),
      reason: f.get('reason'),
    });
  }
  return (
    <section className="detail-card" aria-label="Execution network">
      <h2>Commercial execution work</h2>
      <p>
        Review capabilities and work eligibility, assign only the disclosed task, and assess
        submitted evidence. Completion and rewards require separate decisions.
      </p>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {data && !data.enabled && (
        <p>
          The execution network is awaiting activation review. No assignment or reward is available.
        </p>
      )}
      <Link className="text-link" href={'/contributor?workspace=' + encodeURIComponent(tenant)}>
        Open assigned task access
      </Link>
      {admin && (
        <details>
          <summary>Review an invited contributor profile</summary>
          <p>
            The identity must already be invited with an authenticator. This review creates no
            tenant membership. Use synthetic eligibility evidence only.
          </p>
          <form className="operator-form" onSubmit={createProfile}>
            <Fields
              names={[
                'principalId',
                'alias',
                'capabilities',
                'markets',
                'workCountries',
                'languages',
                'sectors',
                'eligibilitySourceId',
                'expiresAt',
                'reason',
              ]}
            />
            <label className="field">
              Work category
              <select name="category">
                {[
                  'local_operator',
                  'sourcing_expert',
                  'connector',
                  'interpreter',
                  'technical_adviser',
                  'factory_coordinator',
                  'field_researcher',
                  'verification_professional',
                  'institution_operator',
                  'private_connector',
                ].map((k) => (
                  <option key={k} value={k}>
                    {k.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary-link" disabled={busy}>
              Save reviewed invitation profile
            </button>
          </form>
        </details>
      )}
      {['owner', 'admin', 'operator'].includes(role) && (
        <details>
          <summary>Create a scoped task</summary>
          <form className="operator-form" onSubmit={createTask}>
            <label className="field">
              Work type
              <select name="kind">
                {taskKinds.map((k) => (
                  <option key={k} value={k}>
                    {k.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
            <Fields
              names={[
                'missionId',
                'routeAssignmentId',
                'market',
                'workCountry',
                'location',
                'language',
                'sector',
                'capabilities',
                'instructions',
                'deadline',
                'expiresAt',
                'evidenceRequired',
                'effort',
                'dataHandling',
                'cancellationTerms',
                'disputeTerms',
                'reviewerId',
                'rewardRuleId',
                'reason',
              ]}
            />
            <button className="primary-link" disabled={busy || !data?.enabled}>
              Create task for reviewed assignment
            </button>
          </form>
        </details>
      )}
      {data?.tasks.map((task) => (
        <article key={task.id}>
          <h3>
            {task.configuration.kind.replaceAll('_', ' ')} · {task.configuration.market}
          </h3>
          <p>{task.configuration.instructions}</p>
          {task.late_submission && (
            <p>
              Submitted after the original deadline. Assess timeliness and the disclosed
              late-submission terms.
            </p>
          )}
          <p>
            {task.status} · version {task.version} · reference {task.id}
          </p>
          <details>
            <summary>Original work and review history</summary>
            {task.history?.map((h) => (
              <div key={h.version}>
                <p>
                  {h.action}: {h.reason}
                </p>
                {h.details.body && <p>{h.details.body}</p>}
                {h.details.rationale && <p>{h.details.rationale}</p>}
              </div>
            ))}
          </details>
          {task.status === 'CREATED' && admin && (
            <form className="operator-form" onSubmit={(e) => taskEvent(e, task)}>
              <input type="hidden" name="action" value="ASSIGN" />
              <label className="field">
                Reviewed profile
                <select name="profileId" required>
                  <option value="">Choose eligible work profile</option>
                  {data.profiles
                    .filter(
                      (p) =>
                        p.configuration.status === 'ACTIVE' &&
                        !data.profiles.some(
                          (other) =>
                            other.principal_id === p.principal_id && other.version > p.version,
                        ),
                    )
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.configuration.alias} · {p.configuration.capabilities.join(', ')}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                Relationship disclosure
                <input name="relationshipDisclosure" required minLength={3} maxLength={500} />
              </label>
              <Fields names={['reason']} />
              <button className="primary-link" disabled={busy || !data.enabled}>
                Approve exact assignment
              </button>
            </form>
          )}
          {task.status === 'SUBMIT' && (
            <form className="operator-form" onSubmit={(e) => review(e, task)}>
              <label className="field">
                Evidence quality (0–4)
                <input type="number" name="quality" min={0} max={4} required />
              </label>
              <label className="field">
                Timeliness (0–4)
                <input type="number" name="timeliness" min={0} max={4} required />
              </label>
              <label className="field">
                Review rationale
                <input name="rationale" required minLength={3} maxLength={500} />
              </label>
              <Fields names={['reason']} />
              <button className="primary-link" disabled={busy || !data.enabled}>
                Review original submitted declaration
              </button>
            </form>
          )}
          {['SUBMIT', 'REVIEW', 'DISPUTE'].includes(task.status) && (
            <form className="operator-form" onSubmit={(e) => taskEvent(e, task)}>
              <label className="field">
                Evidence decision
                <select name="action">
                  {task.status === 'REVIEW' && (
                    <option value="COMPLETE">Complete reviewed task</option>
                  )}
                  {task.status === 'DISPUTE' ? (
                    <option value="RESOLVE">Resolve dispute, preserve history</option>
                  ) : (
                    <>
                      <option value="REQUEST_CORRECTION">Request corrected evidence</option>
                      <option value="REJECT">Reject submitted work</option>
                    </>
                  )}
                </select>
              </label>
              {task.status === 'DISPUTE' && (
                <label className="field">
                  Dispute disposition
                  <select name="resolution">
                    <option value="REOPEN">Reopen evidence review</option>
                    <option value="REJECT">Reject disputed work</option>
                    <option value="UPHOLD">Uphold previously completed work</option>
                  </select>
                </label>
              )}
              <Fields names={['reason']} />
              <button className="primary-link" disabled={busy || !data.enabled}>
                Save independent decision
              </button>
            </form>
          )}
          {task.status === 'COMPLETE' && ['owner', 'admin', 'operator'].includes(role) && (
            <form
              className="operator-form"
              onSubmit={(e) => {
                e.preventDefault();
                void act('network-assess', {
                  taskId: task.id,
                  reason: new FormData(e.currentTarget).get('reason'),
                });
              }}
            >
              <Fields names={['reason']} />
              <button className="primary-link" disabled={busy || !data.enabled}>
                Assess contribution once
              </button>
            </form>
          )}
        </article>
      ))}
      <details>
        <summary>Reviewed work dimensions by task category</summary>
        <p>
          These human-reviewed dimensions are evidence of task work, with no universal ranking or
          inferred financial attribution.
        </p>
        {data?.performance.map((p) => (
          <article key={p.principal_id + p.task_kind + p.market}>
            <h3>
              {p.task_kind.replaceAll('_', ' ')} · {p.market}
            </h3>
            <p>
              {p.completed_reviewed_tasks} completed reviewed tasks · evidence quality{' '}
              {p.evidence_quality}/4 · timeliness {p.timeliness}/4
            </p>
            <ul>
              {p.rationale.map((r) => (
                <li key={r.taskId}>{r.rationale}</li>
              ))}
            </ul>
          </article>
        ))}
      </details>
      {admin && (
        <details>
          <summary>Current private work profiles</summary>
          {data?.profiles
            .filter(
              (p) =>
                !data.profiles.some(
                  (n) => n.principal_id === p.principal_id && n.version > p.version,
                ),
            )
            .map((p) => (
              <form
                className="operator-form"
                key={p.id}
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void act('network-profile', {
                    ...p.configuration,
                    id: crypto.randomUUID(),
                    principalId: p.principal_id,
                    version: p.version + 1,
                    status: f.get('status'),
                    reason: f.get('reason'),
                  });
                }}
              >
                <p>
                  {p.configuration.alias} · {p.configuration.status} · reviewed countries{' '}
                  {p.configuration.workCountries.join(', ')}
                </p>
                <label className="field">
                  Reviewed profile status
                  <select name="status">
                    <option value="SUSPENDED">Suspend task access</option>
                    <option value="RETIRED">Retire profile</option>
                    <option value="ACTIVE">Renew reviewed eligibility</option>
                  </select>
                </label>
                <Fields names={['reason']} />
                <button className="text-link" disabled={busy}>
                  Append status review
                </button>
              </form>
            ))}
        </details>
      )}
      {admin && (
        <details>
          <summary>Independent reward approval</summary>
          <p>
            Use the assessed contribution reference and current source. The disclosed
            original-currency rule determines the obligation. No automatic payout is performed.
          </p>
          <form
            className="operator-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void act('network-reward', {
                commandId: crypto.randomUUID(),
                contributionId: f.get('contributionId'),
                sourceId: f.get('sourceId'),
                reason: f.get('reason'),
              });
            }}
          >
            <label className="field">
              Contribution reference
              <input name="contributionId" required />
            </label>
            <label className="field">
              Reward approval source reference
              <input name="sourceId" required />
            </label>
            <Fields names={['reason']} />
            <button className="primary-link" disabled={busy || !data?.enabled}>
              Record independently approved obligation
            </button>
          </form>
        </details>
      )}
    </section>
  );
}
