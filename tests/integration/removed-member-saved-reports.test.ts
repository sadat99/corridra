import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  buildWorld,
  digest,
  options,
  sameBytes,
  sha,
  type Outcome,
  type Row,
  type World,
} from './removed-member-support';
import { CustomerProgrammeService } from '../../packages/auth/src/customer-programmes';
import { CustomerParticipantService } from '../../packages/auth/src/customer-participants';
import { CustomerMissionShareService } from '../../packages/auth/src/customer-mission-shares';

// Removed members, saved reports and assigned reports (owner decision, 11 Nov 2026: "No, remove access (Recommended)";
// ADR-036 and ADR-040 amendments). A report that staff delivered for a request is tied to that request's workspace: once the
// person who wrote the request is no longer a member they see none of it, and cannot view, answer, save, remove or accept it.
// Which rule applies to a saved report (the derivation is recorded in ADR-036):
//   1. delivered by an assignment to a request THIS person wrote -> follows that request's workspace (hidden once removed);
//   2. saved by a bearer link that has no assignment at all -> stays theirs (it is outside any workspace);
//   3. saved by a bearer link whose assignment names a request ANOTHER member wrote -> stays theirs, because the owner's
//      question was about what a person wrote. The owner can narrow this later; the tests below pin the present rule.
// Every refusal is byte for byte the refusal of an id that does not exist. Fails on main (REMOVED_BASE_CHECK=1).
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  const readdir = (async (path: unknown, ...rest: unknown[]) => {
    const names = (await (real.readdir as (...a: unknown[]) => Promise<unknown[]>)(
      path,
      ...rest,
    )) as unknown[];
    const { removedFileHidden } = await import('./removed-member-hide');
    return names.filter((n) => !removedFileHidden(String(path), String(n)));
  }) as typeof real.readdir;
  return { ...real, readdir, default: { ...real, readdir } };
});

let w: World;
let programmeId: string;
const registrations: Record<string, string> = {};
let shared: { id: string; version: number } | undefined;
const sharedSummary = 'Synthetic supplier objective of lena';
let before: Record<string, string>;
let portfolioBefore: Record<string, Row>;
const REPORT_TABLES = [
  'app.customer_delivery_assignment',
  'app.delivery_link',
  'app.delivery_publication',
  'customer_private.saved_mission',
  'customer_private.saved_mission_command',
];
const sorted = (ids: string[]) => [...ids].sort();
const text = (outcome: Outcome) => (outcome.ok ? 'ok' : `${outcome.code} ${outcome.message}`);
const shares = (person: string) =>
  new CustomerMissionShareService(w.f.runtime, w.f.auth, options, async () => w.session(person));
const participants = (person: string) =>
  new CustomerParticipantService(w.f.runtime, w.f.auth, options, async () => w.session(person));
// One mission link as customer.programme_projection_own returns it to the participant.
const projectionLink = async (person: string, registration: string, link: string) => {
  const own = (
    await w.row(person, 'SELECT customer.programme_projection_own($1,NULL) AS r', [registration])
  ).r as {
    missionLinks: { id: string; summary: string | null; available: boolean }[];
  };
  return own.missionLinks.find((item) => item.id === link);
};
const portfolio = async (person: string) =>
  (await w.row(person, 'SELECT customer.company_portfolio(NULL,5) AS r')).r as Row;

// Every saved report path that takes a saved id, with the refusal an unknown id gets on it.
const paths: { name: string; sql: string; args: (id: string) => unknown[]; message?: string }[] = [
  {
    name: 'saved_mission_action (view)',
    sql: 'SELECT customer.saved_mission_action($1) AS r',
    args: (id) => [id],
    message: 'Saved mission unavailable',
  },
  {
    name: 'saved_mission_action (respond)',
    sql: 'SELECT customer.saved_mission_action($1,$2,$3,$4) AS r',
    args: (id) => [id, randomUUID(), randomUUID(), 'A response that is long enough'],
    message: 'Saved mission unavailable',
  },
  {
    name: 'saved_mission_decisions',
    sql: 'SELECT customer.saved_mission_decisions($1) AS r',
    args: (id) => [id],
    message: 'Saved mission unavailable',
  },
  {
    name: 'specification_confirmation_requests',
    sql: 'SELECT customer.specification_confirmation_requests($1) AS r',
    args: (id) => [id],
    message: 'Saved mission unavailable',
  },
  {
    name: 'saved_mission_book',
    sql: 'SELECT customer.saved_mission_book($1,$2,$3,true) AS r',
    args: (id) => [id, 'TRIP', randomUUID()],
    message: 'Saved mission unavailable',
  },
  {
    name: 'decision_card_state',
    sql: 'SELECT customer.decision_card_state($1) AS r',
    args: (id) => [id],
    message: 'Saved mission unavailable',
  },
  {
    name: 'remove_saved_mission',
    sql: 'SELECT customer.remove_saved_mission($1,$2) AS r',
    args: (id) => [randomUUID(), id],
    message: 'Saved mission unavailable',
  },
];

beforeAll(async () => {
  w = await buildWorld();
  // The participant side: olive runs a programme, lena registers and shares one of her workspace requests with it.
  const programmeWorkspace = await w.provision('olive', 'Synthetic programme workspace');
  programmeId = (
    await new CustomerProgrammeService(w.f.runtime, w.f.auth, options, async () =>
      w.session('olive'),
    ).create({
      commandId: randomUUID(),
      workspaceId: programmeWorkspace,
      name: 'Synthetic removed member programme',
      reportingPurpose: 'Synthetic isolated summary consent scenario',
      acknowledged: true,
    })
  ).id;
  for (const person of ['lena', 'sam']) {
    const invitation = await participants('olive').command({
      action: 'invite',
      commandId: randomUUID(),
      workspaceId: programmeWorkspace,
      programmeId,
      label: 'Synthetic private invitation',
      acknowledged: true,
    });
    registrations[person] = (
      await participants(person).command({
        action: 'accept',
        commandId: randomUUID(),
        programmeId,
        token: invitation.token,
        displayLabel: 'Synthetic ' + person + ' participant',
        consented: true,
      })
    ).id;
  }
  shared = await shares('lena').command({
    action: 'share',
    commandId: randomUUID(),
    registrationId: registrations.lena,
    requestId: w.requests.lena![1],
    summary: sharedSummary,
    consented: true,
    expectedVersion: 0,
  });
  await shares('sam').command({
    action: 'share',
    commandId: randomUUID(),
    registrationId: registrations.sam,
    requestId: w.requests.sam![1],
    summary: 'Synthetic supplier objective of sam',
    consented: true,
    expectedVersion: 0,
  });
  before = await digest(w.f.owner, REPORT_TABLES);
  portfolioBefore = { lena: await portfolio('lena'), rex: await portfolio('rex') };
}, 900000);
afterAll(async () => {
  await w?.f.close();
});

describe('while everyone is a member (CONTROLS, they hold on main too)', () => {
  test('lena and rex hold the report delivered for their request and both bearer-saved reports', async () => {
    for (const person of ['lena', 'rex']) {
      const ids = await w.savedIds(person);
      expect(sorted(ids)).toEqual(
        sorted([
          w.reports[person]!.savedId,
          w.bearer[person]!.assignedToSam,
          w.bearer[person]!.unassigned,
        ]),
      );
      expect(await w.assignedIds(person)).toEqual([w.reports[person]!.assignmentId]);
    }
  });

  test('the participant sees their shared objective with its request id and text, and the organiser sees the text', async () => {
    const own = (
      await shares('lena').summaries({ registrationId: registrations.lena, view: 'own' })
    ).objectives[0];
    expect(own).toMatchObject({ requestId: w.requests.lena![1], summary: sharedSummary });
    const managed = await shares('olive').summaries({
      registrationId: registrations.lena,
      view: 'manage',
    });
    expect(JSON.stringify(managed)).toContain(sharedSummary);
    const choices = JSON.stringify(
      await shares('lena').choices({ registrationId: registrations.lena }),
    );
    // The request that is not shared yet is on offer.
    expect(choices).toContain(w.requests.lena![0]);
  });
});

describe.each([
  ['leave', 'lena'],
  ['owner revoke', 'rex'],
])('a member removed by %s', (how, person) => {
  test('CONTROL (holds on main too): is removed, and the revocation row is there', async () => {
    if (how === 'leave') await w.leave(person, w.W);
    else await w.revoke('olive', w.W, w.members[person]!);
    expect(
      (
        await w.f.owner.query(
          'SELECT count(*)::int AS n FROM customer_private.workspace_access_revocation WHERE member_id=$1',
          [w.members[person]],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  test('lists no report that staff delivered for their request, and no assignment, but keeps both bearer-saved reports', async () => {
    const ids = await w.savedIds(person);
    expect(ids).not.toContain(w.reports[person]!.savedId);
    // Rules 2 and 3 in the header: the report stays theirs.
    expect(sorted(ids)).toEqual(
      sorted([w.bearer[person]!.assignedToSam, w.bearer[person]!.unassigned]),
    );
    expect(await w.assignedIds(person)).toEqual([]);
  });

  test.each(paths.map((p) => [p.name, p] as const))(
    '%s refuses the hidden report with the text of an id that does not exist',
    async (_name, path) => {
      const removed = await w.attempt(person, path.sql, path.args(w.reports[person]!.savedId));
      const missing = await w.attempt(person, path.sql, path.args(randomUUID()));
      expect(removed.ok, `${how} ${path.name}`).toBe(false);
      if (path.message) expect(text(removed)).toBe(`42501 ${path.message}`);
      expect(sameBytes(removed, missing), `${how} ${path.name}`).toBe(true);
    },
  );

  test('saving the report again from its own link and accepting its assignment are refused like unknown ones', async () => {
    const link = w.reports[person]!.link;
    const removed = await w.attempt(person, 'SELECT customer.save_mission_invitation($1,$2) AS r', [
      randomUUID(),
      sha(link.token),
    ]);
    const missing = await w.attempt(person, 'SELECT customer.save_mission_invitation($1,$2) AS r', [
      randomUUID(),
      sha(randomUUID() + randomUUID()),
    ]);
    expect(text(removed)).toBe('42501 Link unavailable or expired');
    expect(sameBytes(removed, missing)).toBe(true);
    const accept = (id: string) =>
      w.attempt(person, 'SELECT customer.accept_assigned_mission($1,$2,true) AS r', [
        randomUUID(),
        id,
      ]);
    const refused = await accept(w.reports[person]!.assignmentId);
    expect(text(refused)).toBe('42501 Assigned mission unavailable');
    expect(sameBytes(refused, await accept(randomUUID()))).toBe(true);
  });

  test('the company portfolio does not count the hidden report as read or as unavailable', async () => {
    const now = await portfolio(person);
    const was = portfolioBefore[person]!;
    expect(JSON.stringify(now)).not.toContain(w.reports[person]!.savedId);
    expect(Number(now.scopesRead)).toBe(Number(was.scopesRead) - 1);
    expect(Number(now.unavailableScopes)).toBe(Number(was.unavailableScopes));
  });

  test('a report saved by a bearer link stays theirs: it can still be opened, answered and removed', async () => {
    const own = w.bearer[person]!;
    for (const id of [own.assignedToSam, own.unassigned])
      await expect(
        w.saved(person).command({ action: 'view', resourceId: id, audience: 'CLIENT_PROGRESS' }),
      ).resolves.toBeTruthy();
    await expect(
      w
        .saved(person)
        .command({ action: 'remove', resourceId: own.unassigned, commandId: randomUUID() }),
    ).resolves.toMatchObject({ removed: true });
    expect(await w.savedIds(person)).toEqual([own.assignedToSam]);
  });
});

// Lena left the workspace in the block above, so these run against a removed participant.
describe('the programme objective of a removed participant', () => {
  const person = 'lena';
  const share = (request: string) =>
    w.attempt(person, 'SELECT customer.programme_mission_command($1,$2,$3) AS r', [
      randomUUID(),
      'share',
      JSON.stringify({
        registrationId: registrations.lena,
        requestId: request,
        summary: 'Synthetic supplier objective again',
        consented: true,
        expectedVersion: 0,
      }),
    ]);
  test('shows as unavailable, with no request id and no text anywhere in the view', async () => {
    const view = await shares(person).summaries({
      registrationId: registrations.lena,
      view: 'own',
    });
    const own = view.objectives[0];
    expect(own).toMatchObject({ id: shared!.id, status: 'UNAVAILABLE' });
    expect(own).not.toHaveProperty('requestId');
    expect(own).not.toHaveProperty('summary');
    expect(JSON.stringify(view)).not.toContain(sharedSummary);
    for (const id of w.requests.lena!) expect(JSON.stringify(view)).not.toContain(id);
  });

  test('the choices no longer offer a request of the workspace', async () => {
    const choices = JSON.stringify(
      await shares(person).choices({ registrationId: registrations.lena }),
    );
    for (const id of w.requests.lena!) expect(choices).not.toContain(id);
  });

  test('a new share of a workspace request is refused like an unknown request', async () => {
    const refused = await share(w.requests.lena![0]!);
    expect(text(refused)).toBe('42501 Private request unavailable');
    expect(sameBytes(refused, await share(randomUUID()))).toBe(true);
  });

  test('the participant projection (programme_projection_own) shows the link with no summary and not available, like an expired source', async () => {
    const link = await projectionLink(person, registrations.lena!, shared!.id);
    expect(link).toBeTruthy();
    expect(link!.summary).toBeNull();
    expect(link!.available).toBe(false);
  });

  test('CONTROL (stop-only, holds on main too): the objective can still be withdrawn, and the organiser sees it withdrawn', async () => {
    await expect(
      shares(person).command({
        action: 'withdraw',
        commandId: randomUUID(),
        linkId: shared!.id,
        expectedVersion: shared!.version,
        reason: 'Synthetic participant withdraws after leaving',
        acknowledged: true,
      }),
    ).resolves.toBeTruthy();
    expect(
      (await shares('olive').summaries({ registrationId: registrations.lena, view: 'manage' }))
        .objectives[0].status,
    ).toBe('WITHDRAWN');
  });
});

describe('everyone else (CONTROLS, they hold on main too)', () => {
  test('other members and the owner keep every report and assignment', async () => {
    for (const person of ['sam', 'rita', 'olive']) {
      expect(
        (
          await w.attempt(person, 'SELECT customer.decision_card_state($1) AS r', [
            w.reports[person]!.savedId,
          ])
        ).ok,
        `${person}: card state`,
      ).toBe(true);
      expect(await w.savedIds(person)).toContain(w.reports[person]!.savedId);
      expect(await w.assignedIds(person)).toEqual([w.reports[person]!.assignmentId]);
      await expect(
        w.saved(person).command({
          action: 'view',
          resourceId: w.reports[person]!.savedId,
          audience: 'CLIENT_PROGRESS',
        }),
      ).resolves.toBeTruthy();
    }
    expect(
      (await shares('sam').summaries({ registrationId: registrations.sam, view: 'own' }))
        .objectives[0],
    ).toMatchObject({ requestId: w.requests.sam![1] });
  });

  test('canonical links, publications, assignments and saved rows are the same bytes as before anyone left', async () => {
    const now = await digest(w.f.owner, REPORT_TABLES);
    for (const table of ['app.customer_delivery_assignment', 'app.delivery_publication'])
      expect(now[table], table).toBe(before[table]);
    expect(now['app.delivery_link']!.split(':')[0]).toBe(
      before['app.delivery_link']!.split(':')[0],
    );
    // Saved rows are append-only except for the removal marker rex and lena wrote on their own bearer-saved report.
    const count = (value: string) => Number(value.split(':')[0]);
    expect(count(now['customer_private.saved_mission']!)).toBe(
      count(before['customer_private.saved_mission']!),
    );
  });

  test('staff still see the link delivered for the removed authors request', async () => {
    const options = await w.staff.options(w.staffCtx, await w.missionOf(w.requests.lena![0]!));
    expect(options.links.map((l: { id: string }) => l.id)).toContain(w.reports.lena!.link.id);
  });
});

describe('the participant projection follows the workspace membership of the request author', () => {
  const sharedBySam = 'Synthetic supplier objective of sam';
  let samLink: string;
  test('a current member sees the summary of the shared objective (CONTROL, holds on main too)', async () => {
    const managed = await shares('olive').summaries({
      registrationId: registrations.sam,
      view: 'manage',
    });
    samLink = managed.objectives[0].id;
    const link = await projectionLink('sam', registrations.sam!, samLink);
    expect(link?.summary).toBe(sharedBySam);
  });

  test('sam leaves: his link reads with summary NULL and available false, and the organiser view of the objective is unchanged', async () => {
    await w.leave('sam', w.W);
    const link = await projectionLink('sam', registrations.sam!, samLink);
    expect(link?.summary).toBeNull();
    expect(link?.available).toBe(false);
    // CONTROL (organiser side, unchanged): the organiser still sees the text he shared.
    const managed = await shares('olive').summaries({
      registrationId: registrations.sam,
      view: 'manage',
    });
    expect(JSON.stringify(managed)).toContain(sharedBySam);
  });

  test('a new invitation restores the summary: absent while he is out, present after', async () => {
    expect((await projectionLink('sam', registrations.sam!, samLink))?.summary).toBeNull();
    await w.join('olive', 'sam', w.W);
    const link = await projectionLink('sam', registrations.sam!, samLink);
    expect(link?.summary).toBe(sharedBySam);
  });
});

describe('a new invitation gives the reports back', () => {
  test('rita leaves and loses her delivered report, is invited again and finds the same report and assignment', async () => {
    const rita = w.reports.rita!;
    await w.leave('rita', w.W);
    expect(await w.savedIds('rita')).not.toContain(rita.savedId);
    expect(await w.assignedIds('rita')).toEqual([]);
    // The reads that go through the saved report each refuse while she is out, with the text of an unknown id ...
    const reads = paths.filter(
      (path) => !['saved_mission_action (respond)', 'remove_saved_mission'].includes(path.name),
    );
    const refused = async () =>
      Promise.all(
        reads.map(async (path) => {
          const outcome = await w.attempt('rita', path.sql, path.args(rita.savedId));
          return `${path.name}: ${text(outcome)}`;
        }),
      );
    expect(await refused()).toEqual(
      reads.map((path) => `${path.name}: 42501 Saved mission unavailable`),
    );
    await w.join('olive', 'rita', w.W);
    expect(await w.savedIds('rita')).toContain(rita.savedId);
    expect(await w.assignedIds('rita')).toEqual([rita.assignmentId]);
    // ... and none of them says "unavailable" once she is let back in (the book and the card state included).
    for (const path of reads) {
      const outcome = await w.attempt('rita', path.sql, path.args(rita.savedId));
      expect(outcome.ok || outcome.message !== 'Saved mission unavailable', path.name).toBe(true);
    }
    expect(
      (await w.attempt('rita', 'SELECT customer.decision_card_state($1) AS r', [rita.savedId])).ok,
    ).toBe(true);
  });

  test('a report that was removed by its holder stays removed after the person is let back in', async () => {
    const rita = w.reports.rita!;
    await w
      .saved('rita')
      .command({ action: 'remove', resourceId: rita.savedId, commandId: randomUUID() });
    await w.leave('rita', w.W);
    await w.join('olive', 'rita', w.W);
    expect(await w.savedIds('rita')).not.toContain(rita.savedId);
  });
});
