'use client';
import { OperatorWorkbench } from '../../components/operator-workbench';
import { PhoneFold } from '../../components/phone-fold';
import { ContributorInvitations } from './contributor-invitations';
import {
  SubmissionFailure,
  submissionMessage,
  useRetainedSubmission,
} from '../../components/retained-submission';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ActionFeedback, type Feedback } from '../../components/ux/feedback';
import { ReferencePicker } from '../../components/ux/reference-picker';
import { DateTimeInput } from '../../components/ux/date-time-input';
import type { PickerKind } from '../../lib/ux/picker';
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
  purpose?: string;
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
  alias: 'Private working name',
  capabilities: 'Reviewed capabilities, separated by commas',
  markets: 'Market countries, separated by commas',
  workCountries: 'Reviewed work countries, separated by commas',
  languages: 'Languages, separated by commas',
  sectors: 'Sectors, separated by commas',

  market: 'Task market country',
  workCountry: 'Work country',
  location: 'Disclosed work location',
  language: 'Task language',
  sector: 'Task sector',
  instructions: 'Exact work to perform',

  evidenceRequired: 'Evidence to submit',
  effort: 'Expected effort',
  dataHandling: 'Data handling terms',
  cancellationTerms: 'Cancellation terms',
  disputeTerms: 'Dispute terms',
  rewardRuleId: 'Disclosed reward rule reference, optional',
  reason: 'Review reason',
};
// References are chosen by name from a searchable picker, never typed as IDs (D9, CQ-64).
const pickerFields: Record<string, { kind: PickerKind; label: string; hint: string }> = {
  principalId: {
    kind: 'contributor',
    label: 'Contributor',
    hint: 'People who accepted a contributor invitation in this workspace.',
  },
  eligibilitySourceId: {
    kind: 'source',
    label: 'Eligibility evidence',
    hint: 'The source record that shows this person may do this work, for example a checked CV or a reference. Record it under Sources first.',
  },
  missionId: { kind: 'mission', label: 'Mission', hint: 'The mission this task belongs to.' },
  reviewerId: {
    kind: 'reviewer',
    label: 'Reviewer',
    hint: 'Someone other than you. The person who creates a task cannot review it.',
  },
  sourceId: {
    kind: 'source',
    label: 'Approval source',
    hint: 'The source record that supports this decision.',
  },
};
const dateFields: Record<string, { label: string; hint: string }> = {
  expiresAt: {
    label: 'Access ends',
    hint: 'After this time the person can no longer open the work.',
  },
  deadline: { label: 'Submission deadline', hint: 'When the evidence must be submitted.' },
};
function PickerField({ name, tenant }: { name: string; tenant: string }) {
  const [value, setValue] = useState<string | null>(null);
  const field = pickerFields[name]!;
  return (
    <ReferencePicker
      kind={field.kind}
      tenant={tenant}
      label={field.label}
      hint={field.hint}
      name={name}
      value={value}
      onChange={setValue}
      required
    />
  );
}
function DateField({ name }: { name: string }) {
  const [value, setValue] = useState<string | null>(null);
  const field = dateFields[name]!;
  return (
    <DateTimeInput
      label={field.label}
      hint={field.hint}
      name={name}
      value={value}
      onChange={setValue}
      required
    />
  );
}
function Fields({ names, tenant }: { names: string[]; tenant: string }) {
  return (
    <>
      {names.map((name) =>
        pickerFields[name] ? (
          <PickerField key={name} name={name} tenant={tenant} />
        ) : dateFields[name] ? (
          <DateField key={name} name={name} />
        ) : (
          <label className="field" key={name}>
            {labels[name] ?? name}
            <input
              name={name}
              required={name !== 'rewardRuleId'}
              maxLength={name === 'instructions' ? 2000 : 500}
            />
          </label>
        ),
      )}
    </>
  );
}
export function ExecutionNetwork({
  tenant,
  role,
  workspaceName,
  onChooseWorkspace,
}: {
  tenant: string;
  role: string;
  workspaceName?: string;
  onChooseWorkspace?: () => void;
}) {
  const [data, setData] = useState<Snapshot | null>(null),
    [message, setMessage] = useState(''),
    [feedback, setFeedback] = useState<{ form: HTMLFormElement; value: Feedback } | null>(null),
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
  const submit = useRetainedSubmission();
  // Feedback shows next to the form that caused it and nowhere else, so an old error never sits
  // beside a later action (CQ-59).
  async function act(action: string, input: unknown, form: HTMLFormElement) {
    setBusy(true);
    setMessage('');
    setFeedback(null);
    const show = (kind: 'success' | 'error', text: string) =>
      setFeedback({ form, value: { kind, text } });
    try {
      const result = await submit(form, action, input, request);
      const receipt = result.id ? `Saved. Reference ${result.id}.` : 'Saved.';
      show('success', receipt);
      try {
        setData(await request('network'));
      } catch {
        show(
          'success',
          receipt +
            ' The list did not refresh. Refresh execution work instead of submitting again.',
        );
      }
    } catch (e) {
      show('error', submissionMessage(e, 'Work could not be saved'));
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
    void act(
      'network-profile',
      {
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
      },
      e.currentTarget,
    );
  }
  function createTask(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const input: Record<string, unknown> = { id: crypto.randomUUID() };
    for (const name of [
      'missionId',
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
    if (f.get('routeAssignmentId')) input.routeAssignmentId = f.get('routeAssignmentId');
    void act('network-task', input, e.currentTarget);
  }
  function taskEvent(e: FormEvent<HTMLFormElement>, task: Task) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      action = String(f.get('action'));
    void act(
      'network-event',
      {
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
      },
      e.currentTarget,
    );
  }
  function review(e: FormEvent<HTMLFormElement>, task: Task) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void act(
      'network-review',
      {
        commandId: crypto.randomUUID(),
        taskId: task.id,
        version: task.version,
        evidenceQuality: Number(f.get('quality')),
        timeliness: Number(f.get('timeliness')),
        rationale: f.get('rationale'),
        reason: f.get('reason'),
      },
      e.currentTarget,
    );
  }
  return (
    <section
      className="detail-card ux-governance-panel ux-network"
      data-operator-workbench
      aria-label="Execution network"
    >
      <header className="ux-network-heading">
        <div>
          <p className="label">CORRIDRA NETWORK</p>
          <h2>Commercial execution work</h2>
          <p>Invite the right person. Define the work. Review the evidence.</p>
        </div>
        <span className="ux-network-state">
          {data ? (data.enabled ? 'Network enabled' : 'Network paused') : 'Checking access…'}
        </span>
      </header>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {feedback &&
        createPortal(
          <ActionFeedback
            scope="network"
            feedback={feedback.value}
            onClear={() => setFeedback(null)}
          />,
          feedback.form,
        )}
      {!data && (
        <p>
          {message
            ? 'This section could not be loaded. Refresh it or verify your current access.'
            : 'Loading reviewed workspace…'}
        </p>
      )}
      {data && !data.enabled && (
        <aside className="ux-network-paused" aria-label="Network readiness">
          <h3>Network is paused{workspaceName ? ` in ${workspaceName}` : ' in this workspace'}.</h3>
          <p>
            Activation applies to each workspace separately. New invitations, assignments and
            rewards require an enabled workspace. Existing history remains available.
          </p>
          <p>
            Choose an enabled workspace using the Workspace selector above. If your workspace is not
            available, ask its owner to confirm your membership. A customer account does not grant
            operator access.
          </p>
          {onChooseWorkspace && (
            <button className="text-link" type="button" onClick={onChooseWorkspace}>
              Choose workspace
            </button>
          )}
        </aside>
      )}
      {admin && <ContributorInvitations tenant={tenant} />}
      <OperatorWorkbench
        label="Execution work sections"
        sections={[
          { label: 'Tasks and decisions', heading: 'Current disclosed tasks' },
          { label: 'Quality and timeliness', heading: 'Reviewed work dimensions by task category' },
          ...(admin
            ? [
                { label: 'Contributor invitations', heading: 'Invite a contributor' },
                { label: 'Eligibility and status', heading: 'Current private work profiles' },
                { label: 'Reward obligations', heading: 'Independent reward approval' },
                { label: 'Compensations', heading: 'Compensate an unreconciled reward obligation' },
              ]
            : []),
        ]}
      />
      <p>
        Review capabilities and work eligibility, assign only the disclosed task, and assess
        submitted evidence. Completion and rewards require separate decisions.
      </p>
      <div className="workspace-links">
        <button
          className="text-link"
          disabled={busy}
          onClick={() =>
            void request('network')
              .then(setData)
              .catch((e) => setMessage(e.message))
          }
        >
          Refresh execution work
        </button>
        <a href="#workspace-missions">Open missions</a>
        <a href="#workspace-sources">Open sources and claims</a>
        <a href="#workspace-authenticator">Verify current access</a>
        <Link className="text-link" href={'/contributor?workspace=' + encodeURIComponent(tenant)}>
          Open assigned task access
        </Link>
      </div>
      {admin && (
        <details>
          <summary>Review an invited contributor profile</summary>
          <p>
            The identity must already be invited with an authenticator. This review creates no
            tenant membership. Choose the eligibility evidence from your recorded sources.
          </p>
          <form className="operator-form" onSubmit={createProfile}>
            <Fields
              tenant={tenant}
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
              tenant={tenant}
              names={[
                'missionId',
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
            <details className="ops-advanced-filters">
              <summary>Advanced (developers)</summary>
              <label className="field">
                Route assignment reference (optional; the mission&apos;s current route is used)
                <input name="routeAssignmentId" />
              </label>
            </details>
            <button className="primary-link" disabled={busy || !data?.enabled}>
              Create task for reviewed assignment
            </button>
          </form>
        </details>
      )}
      <PhoneFold
        summary={`Disclosed tasks in this workspace (${data?.tasks.length ?? 0})`}
        className="ux-network-tasks"
      >
        <h3>Current disclosed tasks</h3>
        {data && !data.tasks.length && (
          <p>
            No disclosed tasks are recorded in this workspace. Eligibility and exact assignment
            remain required before work can start.
          </p>
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
                <Fields tenant={tenant} names={['reason']} />
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
                <Fields tenant={tenant} names={['reason']} />
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
                <Fields tenant={tenant} names={['reason']} />
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
                  void act(
                    'network-assess',
                    {
                      taskId: task.id,
                      reason: new FormData(e.currentTarget).get('reason'),
                    },
                    e.currentTarget,
                  );
                }}
              >
                <Fields tenant={tenant} names={['reason']} />
                <button className="primary-link" disabled={busy || !data.enabled}>
                  Assess contribution once
                </button>
              </form>
            )}
          </article>
        ))}
      </PhoneFold>
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
                  void act(
                    'network-profile',
                    {
                      ...p.configuration,
                      id: crypto.randomUUID(),
                      principalId: p.principal_id,
                      version: p.version + 1,
                      status: f.get('status'),
                      reason: f.get('reason'),
                    },
                    e.currentTarget,
                  );
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
                <Fields tenant={tenant} names={['reason']} />
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
              void act(
                'network-reward',
                {
                  commandId: crypto.randomUUID(),
                  contributionId: f.get('contributionId'),
                  sourceId: f.get('sourceId'),
                  reason: f.get('reason'),
                },
                e.currentTarget,
              );
            }}
          >
            <label className="field">
              Contribution reference
              <input name="contributionId" required />
            </label>
            <PickerField name="sourceId" tenant={tenant} />
            <Fields tenant={tenant} names={['reason']} />
            <button className="primary-link" disabled={busy || !data?.enabled}>
              Record independently approved obligation
            </button>
          </form>
        </details>
      )}
      {admin && (
        <details>
          <summary>Compensate an unreconciled reward obligation</summary>
          <p>
            This appends an exact negative entry to the existing ledger. It does not reverse a bank
            payment or remove the original obligation.
          </p>
          <form
            className="operator-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void act(
                'network-reverse',
                {
                  commandId: crypto.randomUUID(),
                  ledgerId: f.get('ledgerId'),
                  sourceId: f.get('sourceId'),
                  reason: f.get('reason'),
                },
                e.currentTarget,
              );
            }}
          >
            <label className="field">
              Original reward ledger reference
              <input name="ledgerId" required />
            </label>
            <PickerField name="sourceId" tenant={tenant} />
            <Fields tenant={tenant} names={['reason']} />
            <button className="primary-link" disabled={busy || !data?.enabled}>
              Record compensating obligation
            </button>
          </form>
        </details>
      )}
    </section>
  );
}
