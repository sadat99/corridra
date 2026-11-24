import { rollback, type DatabaseClient, type DatabasePool } from '@corridra/db';
import { dataCleanupKeepList } from './customer-data-cleanup';

// Offline schema-owner report only (B11b, owner decision 23 Nov 2026: "dont delete any existing users"). No request handler
// imports this module. It writes nothing: it runs in a read-only transaction that is always rolled back.
//
// Why it only reports. Every lifecycle that retires this data names a signed-in person as its actor: the workspace and
// programme archives, the invitation revoke, the registration withdrawal and the request withdrawal need a live customer
// session of the owner, organiser, participant or sender, and closing a problem report needs a staff owner or admin with a
// fresh authenticator check. An offline step has no such session, and making one up would record a person as doing
// something they did not do. So the people retire the data on the existing screens, and this step is the honest preview
// before and the proof after: it finds each target by exact name, says for each one whether it was found, not found or
// found more than once, and only when every target is found exactly once says how each one stands now and prints one
// checklist line per step in an order that is safe. A target that does not resolve never stops the report (B8b, after
// the production dry run of 24 Nov 2026 stopped at the request): the report then lists what the QA workspace holds, so
// the next run shows what exists, and gives no checklist, so nothing can be retired from a guess.
//
// Its output is printed in public Actions logs: the fixed names below and 8-character ids only, never an address of a
// person and never a name read from the database. The one exception is the request list of the QA workspace itself,
// shown only when the request target does not resolve: the objective and market of each request there, shortened, with
// anything that looks like an address or a link left out.
export type QaDataRetirePlan = {
  workspace: string;
  /** The QA workspace existed when the owner decided: a same-named workspace made later is never it. */
  workspaceCreatedBefore: string;
  programme: string;
  problemReport: string;
  request: { title: string; objective: string; markets: readonly string[] };
  companyProfile: string;
  keep: readonly string[];
  reason: string;
};

export const qaDataRetirePlan: QaDataRetirePlan = {
  workspace: 'QA-Organiser Workspace (madeup)',
  // The end of the day of the owner decision. A workspace a customer names the same way after it can never resolve.
  workspaceCreatedBefore: '2026-11-24T00:00:00Z',
  programme: 'QA-Test Programme (madeup)',
  problemReport: 'RP-000001',
  // A request has no stored title: the screens make it from the objective and the market the sender chose
  // (apps/web/app/account/request-words.ts), so the request is found by those two.
  request: {
    title: 'Source suppliers in China',
    objective: 'Source suppliers',
    markets: ['CN', 'China'],
  },
  // No lifecycle archives a company profile, so it is listed and kept.
  companyProfile: 'QA-Test Co (madeup)',
  keep: ['QA Test (sample) Customer', 'QA Test (sample) Organiser'],
  // What a person types where a screen asks for a reason.
  reason: 'Owner decision of 23 Nov 2026, retire QA test data without deleting any user',
};

export type QaRetireState = 'retired' | 'still to retire' | 'nothing to do' | 'left alone';
export type QaRetireStep = {
  kind: 'request' | 'registration' | 'invitation' | 'programme' | 'workspace' | 'problem report';
  /** 8 characters, safe to print. */
  id: string;
  label: string;
  state: QaRetireState;
  detail: string;
  /** A role, never a name or an email address. */
  who: string;
  screen: string;
  action: string;
};
export type QaTargetStatus = 'found' | 'not found' | 'more than one' | 'not checked';
export type QaRetireTarget = {
  kind: 'workspace' | 'programme' | 'request' | 'problem report';
  label: string;
  status: QaTargetStatus;
  /** How many records matched; null when the target was not checked. */
  matches: number | null;
};
export type QaDataRetireReport = {
  /** 'targets not resolved': at least one target was not found exactly once, so there are no steps and no checklist. */
  state: 'all retired' | 'still to retire' | 'targets not resolved';
  /** Every planned target, in the order they are looked up. */
  targets: QaRetireTarget[];
  /** In the order the checklist gives them. Empty unless every target resolved exactly once. */
  steps: QaRetireStep[];
  lines: string[];
  checklist: string[];
};

const short = (id: string) => id.slice(0, 8);

const modules: [string, string][] = [
  ['customer.workspace', 'customer workspaces'],
  ['customer_private.workspace_revision', 'workspace lifecycle'],
  ['customer_private.programme_lifecycle_revision', 'programme lifecycle'],
  ['customer_private.programme_invitation', 'programme participants'],
  ['customer_private.owned_request', 'customer requests'],
  ['customer_private.request_withdrawal_event', 'request withdrawal'],
  ['customer_private.problem_report', 'problem reports'],
];

type Found<T> = { status: 'found' | 'not found' | 'more than one'; matches: number; row: T | null };
// Never throws on a count: zero or several matches are an answer, not a failure.
async function find<T extends Record<string, unknown>>(
  db: DatabaseClient,
  sql: string,
  params: unknown[],
): Promise<Found<T>> {
  const found = await db.query<T>(sql, params);
  const matches = found.rowCount ?? found.rows.length;
  return matches === 1
    ? { status: 'found', matches, row: found.rows[0]! }
    : { status: matches === 0 ? 'not found' : 'more than one', matches, row: null };
}
const unchecked = { status: 'not checked' as const, matches: null, row: null };
// Text a customer typed, made safe for a public log: one line, shortened, and never an address or a link.
function shown(value: string | null, max: number) {
  if (value === null || !value.trim()) return '(empty)';
  const text = value.replace(/\s+/g, ' ').trim();
  if (/@|:\/\/|www\./i.test(text)) return '(hidden)';
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

async function read(db: DatabaseClient, plan: QaDataRetirePlan): Promise<QaDataRetireReport> {
  // A kept name can never be a target, whatever plan is passed.
  const keptNames = [...plan.keep, ...dataCleanupKeepList.map((entry) => entry.name)];
  if (
    [plan.workspace, plan.programme, plan.companyProfile].some((name) => keptNames.includes(name))
  )
    throw new Error('A kept name cannot be a retirement target');
  for (const [relation, label] of modules) {
    const present = await db.query<{ present: boolean }>(
      'SELECT to_regclass($1) IS NOT NULL AS present',
      [relation],
    );
    if (!present.rows[0]!.present) throw new Error(`Install the ${label} module first`);
  }
  const authority = await db.query<{ approved: boolean }>(`SELECT pg_has_role(current_user,
    (SELECT relowner FROM pg_class WHERE oid='customer.workspace'::regclass),'MEMBER') AS approved`);
  if (!authority.rows[0]?.approved)
    throw new Error('Offline customer schema-owner authority is required');
  // One report at a time, so two runs never interleave their lines. An advisory lock writes nothing.
  await db.query("SELECT pg_advisory_xact_lock(hashtext('corridra:qa-data-retire'))");

  // Every workspace of that name counts, so two are never resolved whichever is older. The one match must also have
  // existed at the owner decision: a workspace a customer names the same way later is never taken for the QA one.
  const named = await find<{ id: string; archived: boolean; existed: boolean }>(
    db,
    `SELECT t.id::text AS id,customer_private.workspace_archived(t.id) AS archived,
      w.created_at<$2::timestamptz AS existed
    FROM app.tenant t JOIN customer.workspace w ON w.tenant_id=t.id WHERE t.name=$1`,
    [plan.workspace, plan.workspaceCreatedBefore],
  );
  const late = named.row !== null && !named.row.existed;
  const workspace = late ? null : named.row;
  const programmeFound = workspace
    ? await find<{ id: string; archived: boolean }>(
        db,
        `SELECT c.id::text AS id,c.archived FROM customer_private.programme_current c
        JOIN customer_private.programme_creation pc ON pc.programme_id=c.id AND pc.workspace_id=c.tenant_id
        WHERE c.tenant_id=$1 AND c.name=$2`,
        [workspace.id, plan.programme],
      )
    : unchecked;
  // Only within the QA workspace. The brief is read for the two fields the title is made from and nothing else.
  const requestFound = workspace
    ? await find<{ id: string; withdrawn: boolean; revoked: boolean; status: string }>(
        db,
        `SELECT o.id::text AS id,customer_private.request_withdrawn(o.id) AS withdrawn,
          EXISTS(SELECT FROM customer_private.request_revocation v WHERE v.request_id=o.id) AS revoked,m.status
        FROM customer_private.owned_request o
        JOIN app.mission_intake i ON i.tenant_id=o.mission_tenant_id AND i.id=o.mission_id
        JOIN app.mission m ON m.tenant_id=o.mission_tenant_id AND m.id=o.mission_id
        WHERE o.workspace_id=$1 AND i.brief->>'objective'=$2
          AND coalesce(NULLIF(btrim(i.brief->>'market'),''),NULLIF(btrim(i.brief->>'marketCode'),''))=ANY($3::text[])`,
        [workspace.id, plan.request.objective, [...plan.request.markets]],
      )
    : unchecked;
  // The report counts as QA test data only when a member of the QA workspace filed it, now or in the past. Without the
  // QA workspace that cannot be told, so the report is not looked up at all.
  const reportFound = workspace
    ? await find<{ id: string; state: string | null; qa: boolean }>(
        db,
        `SELECT p.id::text AS id,
          (SELECT x.state FROM customer_private.problem_report_status_event x WHERE x.report_id=p.id
            ORDER BY x.seq DESC LIMIT 1) AS state,
          p.reporter_kind='customer' AND (EXISTS(SELECT FROM customer.membership m
              WHERE m.tenant_id=$2 AND m.principal_id=p.customer_principal_id)
            OR EXISTS(SELECT FROM customer_private.workspace_member w
              WHERE w.tenant_id=$2 AND w.principal_id=p.customer_principal_id)) AS qa
        FROM customer_private.problem_report p WHERE p.reference=$1`,
        [plan.problemReport, workspace.id],
      )
    : unchecked;
  const targets: QaRetireTarget[] = [
    {
      kind: 'workspace',
      label: `workspace "${plan.workspace}"`,
      status: late ? 'not found' : named.status,
      matches: late ? 0 : named.matches,
    },
    {
      kind: 'programme',
      label: `programme "${plan.programme}"`,
      status: programmeFound.status,
      matches: programmeFound.matches,
    },
    {
      kind: 'request',
      label: `request "${plan.request.title}"`,
      status: requestFound.status,
      matches: requestFound.matches,
    },
    {
      kind: 'problem report',
      label: `problem report ${plan.problemReport}`,
      status: reportFound.status,
      matches: reportFound.matches,
    },
  ];
  const targetLines = targets.map(
    (target) =>
      `target ${target.label}: ${target.status}${
        target.status === 'more than one' ? ` (${target.matches} match)` : ''
      }${
        target.status === 'not checked'
          ? ', it is looked up inside the QA workspace'
          : target.kind === 'workspace' && late
            ? ', a workspace of that name was made after the owner decision, so it is not the QA workspace'
            : ''
      }`,
  );
  const programme = programmeFound.row;
  const request = requestFound.row;
  const report = reportFound.row;
  if (!workspace || !programme || !request || !report) {
    const unresolved = targets.filter((target) => target.status !== 'found').length;
    const lines = [...targetLines];
    // What the QA workspace holds, so the next run shows what exists. Only when the request is the open question.
    if (workspace && !request) {
      const held = (
        await db.query<{
          id: string;
          objective: string | null;
          market: string | null;
          status: string;
          withdrawn: boolean;
        }>(
          `SELECT left(o.id::text,8) AS id,i.brief->>'objective' AS objective,
            coalesce(NULLIF(btrim(i.brief->>'market'),''),NULLIF(btrim(i.brief->>'marketCode'),'')) AS market,
            m.status,customer_private.request_withdrawn(o.id) AS withdrawn
          FROM customer_private.owned_request o
          LEFT JOIN app.mission_intake i ON i.tenant_id=o.mission_tenant_id AND i.id=o.mission_id
          JOIN app.mission m ON m.tenant_id=o.mission_tenant_id AND m.id=o.mission_id
          WHERE o.workspace_id=$1 ORDER BY o.created_at,o.id LIMIT 51`,
          [workspace.id],
        )
      ).rows;
      lines.push(
        `requests in the workspace "${plan.workspace}" (${short(workspace.id)}): ${
          held.length > 50 ? 'the first 50' : held.length
        }`,
        ...held
          .slice(0, 50)
          .map(
            (row) =>
              `request ${row.id}: objective "${shown(row.objective, 60)}", market "${shown(row.market, 40)}", status ${row.status}${row.withdrawn ? ', withdrawn' : ''}`,
          ),
      );
      // The same title sent by a member of the QA workspace into another workspace: counted, never listed.
      const elsewhere = (
        await db.query<{ id: string; n: number }>(
          `SELECT left(o.workspace_id::text,8) AS id,count(*)::int AS n
          FROM customer_private.owned_request o
          JOIN app.mission_intake i ON i.tenant_id=o.mission_tenant_id AND i.id=o.mission_id
          WHERE o.workspace_id<>$1 AND i.brief->>'objective'=$2
            AND coalesce(NULLIF(btrim(i.brief->>'market'),''),NULLIF(btrim(i.brief->>'marketCode'),''))=ANY($3::text[])
            AND EXISTS(SELECT FROM customer.membership m WHERE m.tenant_id=$1 AND m.principal_id=o.principal_id)
          GROUP BY 1 ORDER BY 1`,
          [workspace.id, plan.request.objective, [...plan.request.markets]],
        )
      ).rows;
      lines.push(
        elsewhere.length
          ? `the same title, sent by a member of the QA workspace into another workspace: ${elsewhere
              .map((row) => `${row.n} in workspace ${row.id}`)
              .join(', ')} (not a target: the plan names the QA workspace only)`
          : 'the same title, sent by a member of the QA workspace into another workspace: none',
      );
    }
    return {
      state: 'targets not resolved',
      targets,
      steps: [],
      lines: [
        ...lines,
        `${unresolved} of ${targets.length} targets not resolved exactly once`,
        'No checklist: nothing is to be retired until every target is found exactly once.',
        'kept, never touched: every user, identity, sign-in and customer account',
        'Nothing was written, changed or deleted.',
      ],
      checklist: [],
    };
  }
  const registrations = (
    await db.query<{ id: string; withdrawn: boolean | null }>(
      `SELECT r.id::text AS id,v.withdrawn FROM customer_private.programme_registration r
      LEFT JOIN customer_private.programme_participant_revocation v ON v.registration_id=r.id
      WHERE r.programme_id=$1 AND r.workspace_id=$2 ORDER BY r.consented_at,r.id`,
      [programme.id, workspace.id],
    )
  ).rows;
  const invitations = (
    await db.query<{ id: string; revoked: boolean; used: boolean; expired: boolean }>(
      `SELECT i.id::text AS id,
        EXISTS(SELECT FROM customer_private.programme_participant_revocation v WHERE v.invitation_id=i.id) AS revoked,
        EXISTS(SELECT FROM customer_private.programme_registration r WHERE r.invitation_id=i.id) AS used,
        i.expires_at<=clock_timestamp() AS expired
      FROM customer_private.programme_invitation i
      WHERE i.programme_id=$1 AND i.workspace_id=$2 ORDER BY i.created_at,i.id`,
      [programme.id, workspace.id],
    )
  ).rows;
  const open = (
    await db.query<{ workspace: boolean; withdrawal: boolean }>(
      `SELECT customer_private.workspace_lifecycle_open() AS workspace,
        customer_private.request_withdrawal_open() AS withdrawal`,
    )
  ).rows[0]!;

  const organiser = 'an owner or admin of the QA workspace';
  const programmeScreen = `/account/delegations/{workspace id starting ${short(workspace.id)}}`;
  // Order: everything a later step could refuse first. The request, registration and invitation go before the programme,
  // the programme before the workspace, and the problem report last because nothing depends on it.
  const steps: QaRetireStep[] = [
    {
      kind: 'request',
      id: short(request.id),
      label: `request "${plan.request.title}"`,
      ...(request.withdrawn
        ? { state: 'retired' as const, detail: 'withdrawn' }
        : request.revoked
          ? { state: 'nothing to do' as const, detail: 'access already revoked by the team' }
          : ['CLOSED', 'CANCELLED'].includes(request.status)
            ? { state: 'nothing to do' as const, detail: 'already closed, cannot be withdrawn' }
            : {
                state: 'still to retire' as const,
                detail: open.withdrawal
                  ? 'not withdrawn'
                  : 'not withdrawn, and request withdrawal is paused: open it first',
              }),
      who: 'the person who sent the request, while still a member of the QA workspace',
      screen: `/account/requests/{request id starting ${short(request.id)}}`,
      action: 'withdraw the request',
    },
    ...registrations.map((row): QaRetireStep => ({
      kind: 'registration',
      id: short(row.id),
      label: 'registration',
      state: row.withdrawn === null ? 'still to retire' : 'retired',
      detail:
        row.withdrawn === null
          ? 'active'
          : row.withdrawn
            ? 'withdrawn by the participant'
            : 'removed by the organiser',
      who: `the participant who registered (or ${organiser}, who can remove them)`,
      screen: `/account/delegations (the participant), or ${programmeScreen}`,
      action: 'withdraw the registration',
    })),
    ...invitations.map((row): QaRetireStep => ({
      kind: 'invitation',
      id: short(row.id),
      label: 'invitation',
      ...(row.revoked
        ? { state: 'retired' as const, detail: 'revoked' }
        : row.used
          ? { state: 'nothing to do' as const, detail: 'accepted, covered by its registration' }
          : row.expired
            ? { state: 'nothing to do' as const, detail: 'expired, can no longer be used' }
            : { state: 'still to retire' as const, detail: 'open' }),
      who: organiser,
      screen: programmeScreen,
      action: 'revoke the invitation',
    })),
    {
      kind: 'programme',
      id: short(programme.id),
      label: `programme "${plan.programme}"`,
      state: programme.archived ? 'retired' : 'still to retire',
      detail: programme.archived ? 'archived' : 'not archived',
      who: organiser,
      screen: programmeScreen,
      action: 'archive the programme',
    },
    {
      kind: 'workspace',
      id: short(workspace.id),
      label: `workspace "${plan.workspace}"`,
      state: workspace.archived ? 'retired' : 'still to retire',
      detail: workspace.archived
        ? 'archived'
        : open.workspace
          ? 'not archived'
          : 'not archived, and workspace changes are paused: open them first',
      who: 'the owner of the QA workspace',
      screen: '/account (the workspace list)',
      action: 'archive the workspace',
    },
    {
      kind: 'problem report',
      id: short(report.id),
      label: `problem report ${plan.problemReport}`,
      ...(!report.qa
        ? {
            state: 'left alone' as const,
            detail:
              'not filed by a member of the QA workspace, so it is not confirmed as QA test data',
          }
        : ['closed', 'resolved'].includes(report.state ?? '')
          ? { state: 'retired' as const, detail: report.state! }
          : { state: 'still to retire' as const, detail: report.state ?? 'received' }),
      who: 'a staff owner or admin, with a fresh authenticator check',
      screen: `/operator/problem-reports/${plan.problemReport}`,
      action: 'close the report with a note',
    },
  ];

  // Listed and kept. Counts and 8-character workspace ids only.
  const profiles = (
    await db.query<{ present: boolean }>(
      "SELECT to_regclass('customer_private.organisation_profile_revision') IS NOT NULL AS present",
    )
  ).rows[0]!.present
    ? (
        await db.query<{ id: string }>(
          `SELECT r.tenant_id::text AS id FROM customer_private.organisation_profile_revision r
          WHERE r.version=(SELECT max(v.version) FROM customer_private.organisation_profile_revision v
            WHERE v.tenant_id=r.tenant_id) AND r.details->>'legalName'=$1 ORDER BY 1`,
          [plan.companyProfile],
        )
      ).rows.map((row) => short(row.id))
    : null;
  const keptWorkspaces = (
    await db.query<{ name: string; ids: string[] }>(
      `SELECT t.name,array_agg(left(t.id::text,8) ORDER BY t.id) AS ids FROM app.tenant t
      WHERE t.name=ANY($1::text[]) GROUP BY t.name`,
      [keptNames],
    )
  ).rows;
  const pending = steps.filter((step) => step.state === 'still to retire');
  const lines = [
    ...targetLines,
    ...steps.map((step) => `${step.label} (${step.id}): ${step.state}, ${step.detail}`),
    `company profile "${plan.companyProfile}": kept, no lifecycle${
      profiles === null
        ? ' (company profiles are not installed)'
        : profiles.length
          ? ` (in workspace ${profiles.join(', ')})`
          : ' (none found by that name)'
    }`,
    ...keptNames.map((name) => {
      const found = keptWorkspaces.find((row) => row.name === name);
      return `kept, never touched: "${name}"${found ? ` (workspace ${found.ids.join(', ')})` : ''}`;
    }),
    'kept, never touched: every user, identity, sign-in and customer account',
  ];
  const checklist = [
    ...steps.map((step, index) => {
      const mark =
        step.state === 'still to retire' ? 'to do' : step.state === 'retired' ? 'done' : 'skip';
      const how =
        step.state === 'still to retire'
          ? `${step.who}: ${step.action} at ${step.screen}`
          : `${step.action}: ${step.detail}`;
      return `${index + 1}. [${mark}] ${step.label} (${step.id}), ${how}`;
    }),
    `Where a screen asks for a reason or a note, type: ${plan.reason}`,
  ];
  return {
    state: pending.length ? 'still to retire' : 'all retired',
    targets,
    steps,
    lines: [
      ...lines,
      'Owner checklist, in this order:',
      ...checklist,
      pending.length ? `${pending.length} still to retire` : 'all retired',
      'Nothing was written, changed or deleted.',
    ],
    checklist,
  };
}

// Read only: one snapshot in a read-only transaction that is always rolled back. The installer refuses to run it together
// with an apply, so it never shares a run with an install.
// The installer passes no plan; the names are fixed above and never taken from input.
export async function reportQaDataRetire(
  pool: DatabasePool,
  plan: QaDataRetirePlan = qaDataRetirePlan,
): Promise<QaDataRetireReport> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    return await read(db, plan);
  } finally {
    // Always released. A failed ROLLBACK leaves the connection in an unknown state, so it is discarded, not reused.
    db.release(await rollback(db));
  }
}
