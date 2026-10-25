export const meta = {
  name: 'corridra-squad',
  description:
    'Run the Corridra squad end to end: authority brief, product packet, architecture and design, build, proof, adversarial review with refutation, fix rounds, record',
  whenToUse:
    'A Corridra build or fix the user opted into running as a workflow. args: {task: string, ui?: boolean, sensitive?: boolean, maxRounds?: number}',
  phases: [
    { title: 'Authority', detail: 'resolve what governs today and stamp it' },
    { title: 'Scope', detail: 'product packet: outcome, preservation, acceptance' },
    { title: 'Design', detail: 'architecture plan, and UI spec for visible work' },
    { title: 'Build', detail: 'single writer of application code' },
    { title: 'Prove', detail: 'gates, adversarial review, design audit' },
    { title: 'Fix', detail: 'confirmed findings only, bounded rounds' },
    { title: 'Record', detail: 'work log, ledger, plan status truth' },
  ],
};

const task = typeof args === 'string' ? args : args && args.task;
if (!task) throw new Error('Pass args: {task: "...", ui: true|false, sensitive: true|false}');
const ui = Boolean(args && args.ui);
const sensitive = Boolean(args && args.sensitive);
const maxRounds = (args && args.maxRounds) || 3;

const STAGE = {
  type: 'object',
  properties: {
    stale: { type: 'boolean', description: 'true if the brief stamp did not match' },
    blocking: {
      type: 'boolean',
      description: 'true if work must stop for the owner or a failed precondition',
    },
    report: { type: 'string', description: 'the full section-by-section output your role defines' },
    ownerDecisions: { type: 'array', items: { type: 'string' } },
  },
  required: ['stale', 'blocking', 'report', 'ownerDecisions'],
};
const BRIEF = {
  type: 'object',
  properties: {
    stamp: { type: 'string' },
    blocking: {
      type: 'boolean',
      description:
        'true if verify failed, main changed authority files, or UNRESOLVED items block this task',
    },
    report: { type: 'string', description: 'the complete Authority Brief' },
    ownerDecisions: { type: 'array', items: { type: 'string' } },
  },
  required: ['stamp', 'blocking', 'report', 'ownerDecisions'],
};
const PROOF = {
  type: 'object',
  properties: {
    stale: { type: 'boolean' },
    ready: { type: 'boolean', description: 'every mandatory check passed on the frozen revision' },
    report: { type: 'string' },
  },
  required: ['stale', 'ready', 'report'],
};
const FINDINGS = {
  type: 'object',
  properties: {
    stale: { type: 'boolean' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocking', 'should fix', 'note'] },
          location: { type: 'string' },
          defect: { type: 'string' },
          scenario: { type: 'string' },
          source: { type: 'string' },
          confidence: { type: 'string', enum: ['traced', 'plausible'] },
        },
        required: ['severity', 'location', 'defect', 'scenario', 'source', 'confidence'],
      },
    },
    report: { type: 'string' },
  },
  required: ['stale', 'findings', 'report'],
};
const VERDICT = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['refuted', 'reason'],
};

let brief = null;

async function resolveAuthority(reason) {
  const result = await agent(
    `Produce the Authority Brief for this Corridra task.${reason ? ` Reason for this run: ${reason}.` : ''}\n\nTask:\n${task}`,
    { agentType: 'corridra-authority', phase: 'Authority', label: 'authority', schema: BRIEF },
  );
  if (!result) throw new Error('The authority stage did not return.');
  brief = result;
  log(`Authority stamp ${brief.stamp}`);
  return brief;
}

function context(parts) {
  return [`AUTHORITY BRIEF (STAMP ${brief.stamp}):\n${brief.report}`, ...parts]
    .filter(Boolean)
    .join('\n\n');
}

// Runs a stage; a stale stamp means a governing file changed mid-run, so re-resolve once and retry.
async function stage(agentType, phaseName, instruction, parts, schema, label) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await agent(`${instruction}\n\n${context(parts)}`, {
      agentType,
      phase: phaseName,
      label: label || agentType.replace('corridra-', ''),
      schema,
    });
    if (!result) return null;
    if (!result.stale) return result;
    log(`${agentType} reported a stale brief; re-resolving authority.`);
    await resolveAuthority(`${agentType} found the stamp changed`);
  }
  throw new Error(`${agentType} still reports a stale brief after re-resolving.`);
}

function stop(at, result) {
  return {
    stoppedAt: at,
    stamp: brief && brief.stamp,
    ownerDecisions: (result && result.ownerDecisions) || [],
    report: result && result.report,
  };
}

phase('Authority');
await resolveAuthority('');
if (brief.blocking) return stop('authority', brief);

phase('Scope');
const packet = await stage(
  'corridra-product',
  'Scope',
  'Write the task packet for this task.',
  [`TASK:\n${task}`],
  STAGE,
);
if (!packet || packet.blocking) return stop('product', packet);

phase('Design');
const [plan, spec] = await parallel([
  () =>
    stage(
      'corridra-architect',
      'Design',
      'Write the build plan for this task packet.',
      [`TASK PACKET:\n${packet.report}`],
      STAGE,
    ),
  () =>
    ui
      ? stage(
          'corridra-designer',
          'Design',
          'Spec mode: write the UI spec for this task packet.',
          [`TASK PACKET:\n${packet.report}`],
          STAGE,
          'designer-spec',
        )
      : Promise.resolve(null),
]);
if (!plan || plan.blocking) return stop('architect', plan);
if (ui && (!spec || spec.blocking)) return stop('designer', spec);

const designDocs = [
  `TASK PACKET:\n${packet.report}`,
  `BUILD PLAN:\n${plan.report}`,
  spec ? `UI SPEC:\n${spec.report}` : '',
];

phase('Build');
let build = await stage(
  'corridra-builder',
  'Build',
  'Implement the build plan.',
  designDocs,
  STAGE,
);
if (!build || build.blocking) return stop('builder', build);

async function prove(round) {
  const reviewers = sensitive ? ['first', 'second'] : ['first'];
  const results = await parallel([
    () =>
      stage(
        'corridra-verifier',
        'Prove',
        'Run every mandatory check on the frozen revision.',
        [`BUILDER REPORT:\n${build.report}`],
        PROOF,
        `verifier r${round}`,
      ),
    ...reviewers.map(
      (name) => () =>
        stage(
          'corridra-reviewer',
          'Prove',
          `Review the change on this branch against its base. You are the ${name} independent reviewer.`,
          [...designDocs, `BUILDER REPORT:\n${build.report}`],
          FINDINGS,
          `reviewer ${name} r${round}`,
        ),
    ),
    () =>
      ui
        ? stage(
            'corridra-designer',
            'Prove',
            'Audit mode: compare the built screens with the UI spec.',
            [`UI SPEC:\n${spec.report}`, `BUILDER REPORT:\n${build.report}`],
            STAGE,
            `designer-audit r${round}`,
          )
        : Promise.resolve(null),
  ]);
  const proof = results[0];
  const reviews = results.slice(1, 1 + reviewers.length).filter(Boolean);
  const audit = results[1 + reviewers.length];
  const candidates = reviews
    .flatMap((review) => review.findings)
    .filter((finding) => finding.severity !== 'note' && finding.confidence === 'traced');
  const seen = new Set();
  const unique = candidates.filter((finding) => {
    const key = `${finding.location}|${finding.defect}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const judged = await parallel(
    unique.map((finding, index) => async () => {
      const votes = await parallel(
        [0, 1].map(
          (skeptic) => () =>
            agent(
              `Try to refute this finding by reproducing or disproving its failure path in the code on this branch. Default to refuted=true unless you can trace the failure yourself.\n\nFINDING:\n${JSON.stringify(finding, null, 2)}\n\n${context([`BUILD PLAN:\n${plan.report}`])}`,
              {
                agentType: 'corridra-reviewer',
                phase: 'Prove',
                label: `refute ${index + 1}.${skeptic + 1} r${round}`,
                schema: VERDICT,
              },
            ),
        ),
      );
      const upheld = votes.filter(Boolean).filter((vote) => !vote.refuted).length;
      return upheld >= 1 ? finding : null;
    }),
  );
  const confirmed = judged.filter(Boolean);
  log(
    `Round ${round}: checks ${proof && proof.ready ? 'READY' : 'NOT READY'}, ${unique.length} candidate finding(s), ${confirmed.length} survived refutation, design audit ${audit ? (audit.blocking ? 'blocking' : 'clear') : 'not run'}.`,
  );
  return { proof, confirmed, audit };
}

phase('Prove');
let outcome = await prove(1);
let round = 1;
while (
  round < maxRounds &&
  (!outcome.proof ||
    !outcome.proof.ready ||
    outcome.confirmed.length ||
    (outcome.audit && outcome.audit.blocking))
) {
  round += 1;
  phase('Fix');
  build = await stage(
    'corridra-builder',
    'Fix',
    'Fix exactly these confirmed problems, nothing else. Never weaken a test to pass.',
    [
      ...designDocs,
      `FAILED CHECKS:\n${outcome.proof ? outcome.proof.report : 'verifier did not return'}`,
      `CONFIRMED FINDINGS:\n${JSON.stringify(outcome.confirmed, null, 2)}`,
      outcome.audit && outcome.audit.blocking ? `DESIGN AUDIT:\n${outcome.audit.report}` : '',
    ],
    STAGE,
    `builder fix r${round}`,
  );
  if (!build || build.blocking) return stop('builder fix', build);
  phase('Prove');
  outcome = await prove(round);
}

const clean =
  outcome.proof &&
  outcome.proof.ready &&
  !outcome.confirmed.length &&
  !(outcome.audit && outcome.audit.blocking);

phase('Record');
const record = await stage(
  'corridra-scribe',
  'Record',
  clean
    ? 'Record this finished run in the work log and ledger, and update plan status words it changed.'
    : `Record this run as NOT READY after ${round} round(s): what passed, what still fails, and the next action.`,
  [
    `TASK PACKET:\n${packet.report}`,
    `BUILDER REPORT:\n${build.report}`,
    `VERIFIER RECEIPTS:\n${outcome.proof ? outcome.proof.report : 'none'}`,
    `OPEN FINDINGS:\n${JSON.stringify(outcome.confirmed, null, 2)}`,
  ],
  STAGE,
);

return {
  ready: Boolean(clean),
  rounds: round,
  stamp: brief.stamp,
  openFindings: outcome.confirmed,
  ownerDecisions: [
    ...brief.ownerDecisions,
    ...packet.ownerDecisions,
    ...plan.ownerDecisions,
    ...((record && record.ownerDecisions) || []),
  ],
  verifier: outcome.proof && outcome.proof.report,
  record: record && record.report,
};
