import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { accessFixture, future } from './access-fixture';
import { migrateCustomerMemberRoles } from '../../packages/db/src/customer-member-role-migrate';
import { migrateCustomerProgrammes } from '../../packages/db/src/customer-programme-migrate';
import { migrateCustomerCompanies } from '../../packages/db/src/customer-company-migrate';
import { migrateCustomerServiceRequests } from '../../packages/db/src/customer-service-request-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import { admitSyntheticCustomerRequests } from '../../packages/auth/src/customer-request-admission';
import {
  CustomerWorkspaceService,
  type CustomerSession,
} from '../../packages/auth/src/customer-workspaces';
import { CustomerProgrammeService } from '../../packages/auth/src/customer-programmes';
import { CustomerServiceRequestService } from '../../packages/auth/src/customer-service-requests';
import { CustomerServiceStaffService } from '../../packages/delivery/src/customer-service-staff';
import { getTeamToday } from '../../packages/auth/src/team-today';
import {
  daysLate,
  filterRows,
  filterTotal,
  lateLabel,
  needsCount,
  needsSummary,
  needsYouNow,
  type MissionPage,
  type TodayMission,
} from '../../apps/web/lib/ux/team-today';

// Team Today redesign (owner, 6 Nov 2026): "Needs you now" merges the new-request and past-due reads, and the
// one-line summary says only what the loaded totals prove.
const observedAt = '2026-11-06T12:00:00Z';
const mission = (id: string, status: string, dueAt: string): TodayMission => ({
  id,
  status,
  due_at: dueAt,
  brief: { company: `Invented ${id}`, objective: 'Source suppliers', market: 'China' },
});
const page = (missions: TodayMission[], total = missions.length): MissionPage => ({
  missions,
  total,
});

describe('needsYouNow', () => {
  test('lists a mission that is both new and late once, with both marks', () => {
    const both = mission('a', 'DRAFT', '2026-10-01T00:00:00Z');
    const rows = needsYouNow(page([both]), page([both]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fresh: true, overdue: true });
  });

  test('puts late missions first, the most overdue at the top, then the rest with the newest due date first', () => {
    const rows = needsYouNow(
      page([
        mission('new-early', 'DRAFT', '2026-11-20T00:00:00Z'),
        mission('new-late-due', 'DRAFT', '2026-12-20T00:00:00Z'),
      ]),
      page([
        mission('late-5', 'OUTREACH', '2026-11-01T00:00:00Z'),
        mission('late-36', 'FOLLOW_UP', '2026-10-01T00:00:00Z'),
      ]),
    );
    expect(rows.map((row) => row.mission.id)).toEqual([
      'late-36',
      'late-5',
      'new-late-due',
      'new-early',
    ]);
  });

  test('keeps a stable order by id when due dates are equal', () => {
    const due = '2026-10-01T00:00:00Z';
    const rows = needsYouNow(
      page([]),
      page([mission('b', 'OUTREACH', due), mission('a', 'OUTREACH', due)]),
    );
    expect(rows.map((row) => row.mission.id)).toEqual(['a', 'b']);
  });

  test('filters to new requests or to late missions', () => {
    const rows = needsYouNow(
      page([mission('new', 'DRAFT', '2026-12-01T00:00:00Z')]),
      page([mission('late', 'OUTREACH', '2026-10-01T00:00:00Z')]),
    );
    expect(filterRows(rows, 'all')).toHaveLength(2);
    expect(filterRows(rows, 'new').map((row) => row.mission.id)).toEqual(['new']);
    expect(filterRows(rows, 'overdue').map((row) => row.mission.id)).toEqual(['late']);
  });
});

describe('late days', () => {
  test('counts whole days between the due date and the moment of the read', () => {
    expect(daysLate('2026-10-01T12:00:00Z', observedAt)).toBe(36);
    expect(lateLabel('2026-10-01T12:00:00Z', observedAt)).toBe('36 days late');
    expect(lateLabel('2026-11-05T11:00:00Z', observedAt)).toBe('1 day late');
  });

  test('says "Due today" within the first day and "Late" when this clock has not reached the due time', () => {
    expect(lateLabel('2026-11-06T08:00:00Z', observedAt)).toBe('Due today');
    expect(lateLabel('2026-11-06T13:00:00Z', observedAt)).toBe('Late');
  });
});

describe('counts and summary', () => {
  test('says no mission needs you when both reads are empty', () => {
    const summary = needsSummary(page([]), page([]), []);
    expect(summary).toEqual({ lead: 'No missions need you now.', detail: '' });
  });

  test('says all are new and late when every mission is both', () => {
    const all = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) =>
      mission(id, 'DRAFT', '2026-10-20T00:00:00Z'),
    );
    const rows = needsYouNow(page(all), page(all));
    expect(needsSummary(page(all), page(all), rows)).toEqual({
      lead: '6 missions need you.',
      detail: 'All 6 are new and past their due date.',
    });
  });

  test('uses the singular for one mission', () => {
    const one = [mission('a', 'DRAFT', '2026-12-01T00:00:00Z')];
    expect(needsSummary(page(one), page([]), needsYouNow(page(one), page([])))).toEqual({
      lead: '1 mission needs you.',
      detail: 'It is a new request.',
    });
    const late = [mission('b', 'OUTREACH', '2026-10-01T00:00:00Z')];
    expect(needsSummary(page([]), page(late), needsYouNow(page([]), page(late))).detail).toBe(
      'It is past its due date.',
    );
    expect(needsSummary(page(late), page(late), needsYouNow(page(late), page(late))).detail).toBe(
      'It is new and past its due date.',
    );
  });

  test('gives each part its own count when the missions are mixed', () => {
    const fresh = page([mission('n', 'DRAFT', '2026-12-01T00:00:00Z')]);
    const overdue = page([
      mission('l1', 'OUTREACH', '2026-10-01T00:00:00Z'),
      mission('l2', 'FOLLOW_UP', '2026-10-02T00:00:00Z'),
    ]);
    expect(needsSummary(fresh, overdue, needsYouNow(fresh, overdue))).toEqual({
      lead: '3 missions need you.',
      detail: '1 is new and 2 are past their due date.',
    });
  });

  test('says "At least" and never adds the totals when not every row was loaded', () => {
    const shared = mission('s', 'DRAFT', '2026-10-01T00:00:00Z');
    const fresh = page([shared], 4);
    const overdue = page([shared, mission('l', 'OUTREACH', '2026-10-02T00:00:00Z')], 9);
    const rows = needsYouNow(fresh, overdue);
    expect(needsCount(fresh, overdue, rows)).toEqual({ count: 9, exact: false });
    expect(needsSummary(fresh, overdue, rows)).toEqual({
      lead: 'At least 9 missions need you.',
      detail: '4 are new and 9 are past their due date.',
    });
    expect(filterTotal('new', fresh, overdue, rows)).toEqual({ count: 4, exact: true });
    expect(filterTotal('overdue', fresh, overdue, rows)).toEqual({ count: 9, exact: true });
    expect(filterTotal('all', fresh, overdue, rows)).toEqual({ count: 9, exact: false });
  });
});

// W3 (workflow intelligence): the Today counts read the paid-service list once. A request in status
// "requested" is one the customer sent and the team has not quoted; it is counted next to the accepted
// quotes. The module is optional, so both counts are listed as unavailable until it is installed.
describe('W3 service requests waiting for a quote', () => {
  const issuer = 'https://ep-w3-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
  const options = { enabled: true, synthetic: true, production: false, issuer };
  const session = (): CustomerSession => ({
    subject: 'synthetic-w3-alice',
    emailVerified: true,
    expiresAt: new Date(Date.now() + 3600000),
  });
  let f: Awaited<ReturnType<typeof accessFixture>>;
  let staff: CustomerServiceStaffService;
  let workspaceId = '';
  const svc = () =>
    new CustomerServiceRequestService(f.runtime, f.auth, options, async () => session());
  const programmes = () =>
    new CustomerProgrammeService(f.runtime, f.auth, options, async () => session());
  const counts = async (ctx = f.users.owner.ctx) => {
    const t = await getTeamToday(f.runtime, ctx);
    return {
      requested: t.serviceRequestsToQuote,
      accepted: t.acceptedQuotesNotStarted,
      unavailable: t.unavailable,
    };
  };
  const create = async () =>
    (
      await svc().command({
        action: 'create',
        commandId: randomUUID(),
        workspaceId,
        contextKind: 'programme',
        contextRef: (
          await programmes().create({
            commandId: randomUUID(),
            workspaceId,
            name: 'Synthetic W3 programme ' + randomUUID().slice(0, 8),
            reportingPurpose: 'Fictional programme used to test Today counts only',
            acknowledged: true,
          })
        ).id as string,
        serviceKey: 'interpreter-day',
        need: 'Synthetic need: an interpreter for two supplier meetings in one city',
        preferredFrom: '2026-12-01',
        preferredTo: '2026-12-03',
        region: 'Dhaka',
      })
    ).id as string;
  const seq = async (id: string) => (await staff.view(f.users.owner.ctx, id)).lastSeq as number;
  const quoteBody = (validUntil: string) => ({
    currency: 'USD',
    components: [
      {
        kind: 'service_fee',
        label: 'Synthetic interpreter day fee',
        treatment: 'included',
        amountMinor: '45000',
      },
      {
        kind: 'tax',
        label: 'Synthetic local sales tax, not included in this price',
        treatment: 'not_included',
        amountMinor: null,
      },
    ],
    scope: 'Synthetic scope: one interpreter for one day of two meetings in Dhaka',
    exclusions: ['Synthetic exclusion: written translation'],
    assumptions: ['Synthetic assumption: both meetings are in the same building'],
    deliveryTerms: 'Synthetic delivery terms: on the agreed day, eight hours',
    paymentTerms: 'Synthetic payment terms are settled later; nothing is charged now',
    validUntil,
  });
  const quote = async (id: string) =>
    staff.command(f.users.owner.ctx, {
      action: 'quote',
      commandId: randomUUID(),
      requestId: id,
      expectedSeq: await seq(id),
      ...quoteBody(future(7)),
    });
  // The service refuses a quote valid for under an hour and records a quote only while it is open, so a quote
  // that has run out is made by moving the stored times of an ordinary quote into the past, as the owner of the
  // test database. The append-only guards are skipped for this one statement (as in revamp-money-database.test.ts),
  // and the table's own check (valid_until after created_at, within 90 days) still holds. No waiting is involved.
  const expireQuote = async (id: string) => {
    const client = await f.owner.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL session_replication_role = 'replica'");
      const moved = await client.query(
        `UPDATE customer_private.service_quote
            SET created_at = created_at - interval '2 days',
                valid_until = clock_timestamp() - interval '1 day'
          WHERE request_id = $1`,
        [id],
      );
      expect(moved.rowCount).toBe(1);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };
  const customer = async (action: string, requestId: string, extra: Record<string, unknown> = {}) =>
    svc().command({ action, commandId: randomUUID(), workspaceId, requestId, ...extra });
  const accept = async (id: string) => {
    const seen = await svc().view({ workspaceId, requestId: id });
    await customer('accept', id, {
      quoteVersion: 1,
      quoteDigest: seen.quote!.digest,
      acknowledged: true,
    });
  };
  const progress = async (action: string, id: string) =>
    staff.command(f.users.owner.ctx, {
      action,
      commandId: randomUUID(),
      requestId: id,
      expectedSeq: await seq(id),
      customerNote: 'Synthetic note for the customer to read',
    });
  const statuses = async () =>
    ((await staff.list(f.users.owner.ctx)).requests as { id: string; status: string }[]).map(
      (item) => item.status,
    );
  let beforeInstall: Awaited<ReturnType<typeof counts>>;

  beforeAll(async () => {
    f = await accessFixture();
    staff = new CustomerServiceStaffService(f.runtime);
    // The module is optional; read Today before it exists.
    beforeInstall = await counts();
    await migrateCustomerMemberRoles(f.owner);
    await migrateCustomerProgrammes(f.owner);
    await migrateCustomerCompanies(f.owner);
    const admitted = await admitSyntheticCustomer(f.owner, {
      issuer,
      subject: session().subject,
      executorId: f.serviceId,
      reason: 'Explicit invented Today count test identity; no real account or email',
    });
    await admitSyntheticCustomerRequests(f.owner, {
      principalId: admitted.id,
      reason: 'Explicit invented synthetic request scope, no commercial activation',
    });
    workspaceId = (
      await new CustomerWorkspaceService(f.runtime, f.auth, options, async () =>
        session(),
      ).provision({ commandId: randomUUID(), name: 'Synthetic W3 workspace' })
    ).id;
  }, 120000);
  afterAll(async () => {
    await f?.close();
  });

  test('W3-1 with the paid-service module not installed both counts are listed as unavailable and stay 0', () => {
    expect(beforeInstall.unavailable).toEqual(
      expect.arrayContaining(['acceptedQuotesNotStarted', 'serviceRequestsToQuote']),
    );
    expect(beforeInstall).toMatchObject({ requested: 0, accepted: 0 });
  });

  test('W3-2 once installed with no request both counts are 0 and neither is listed as unavailable', async () => {
    await migrateCustomerServiceRequests(f.owner);
    const now = await counts();
    expect(now).toMatchObject({ requested: 0, accepted: 0 });
    expect(now.unavailable).not.toContain('acceptedQuotesNotStarted');
    expect(now.unavailable).not.toContain('serviceRequestsToQuote');
  });

  test('W3-3 a request the customer sent and the team has not quoted is counted as requested', async () => {
    await create();
    expect(await counts()).toMatchObject({ requested: 1, accepted: 0 });
    await create();
    expect(await counts()).toMatchObject({ requested: 2, accepted: 0 });
  });

  test('W3-4 an accepted request is counted as accepted as before and not as requested', async () => {
    const id = await create();
    expect(await counts()).toMatchObject({ requested: 3, accepted: 0 });
    await quote(id);
    // Quoted: no longer waiting for a quote, not yet accepted.
    expect(await counts()).toMatchObject({ requested: 2, accepted: 0 });
    await accept(id);
    expect(await counts()).toMatchObject({ requested: 2, accepted: 1 });
  });

  test('W3-5 quoted, declined, withdrawn, expired, in progress, delivered and closed requests are not counted as requested', async () => {
    const quoted = await create();
    await quote(quoted);
    const declined = await create();
    await quote(declined);
    await customer('decline', declined, { note: null });
    const withdrawn = await create();
    await customer('withdraw', withdrawn, { note: null });
    const expired = await create();
    await quote(expired);
    await expireQuote(expired);
    const started = await create();
    await quote(started);
    await accept(started);
    await progress('start', started);
    const delivered = await create();
    await quote(delivered);
    await accept(delivered);
    await progress('start', delivered);
    await progress('deliver', delivered);
    const closed = await create();
    await quote(closed);
    await accept(closed);
    await progress('start', closed);
    await progress('deliver', closed);
    await progress('close', closed);
    // Every status below was really reached, so the negative result is not an empty one.
    const seen = await statuses();
    for (const status of [
      'requested',
      'quoted',
      'accepted',
      'declined',
      'withdrawn',
      'expired',
      'in_progress',
      'delivered',
      'closed',
    ])
      expect(seen, status).toContain(status);
    expect(seen.filter((status) => status === 'requested')).toHaveLength(2);
    // Only the two requests still waiting count as requested; the one accepted request still counts as accepted.
    expect(await counts()).toMatchObject({ requested: 2, accepted: 1 });
  });

  test('W3-6 a role without access to the paid-service list sees both counts as unavailable, never zero', async () => {
    for (const ctx of [f.users.operator.ctx, f.users.viewer.ctx, f.users.reviewer.ctx]) {
      const read = await counts(ctx);
      expect(read.unavailable).toEqual(
        expect.arrayContaining(['acceptedQuotesNotStarted', 'serviceRequestsToQuote']),
      );
      expect(read).toMatchObject({ requested: 0, accepted: 0 });
    }
  });

  test('W3-7 counts follow the team that handles the request: a request taken by another team is not counted', async () => {
    // Before anyone takes a request, every team reads the same waiting requests.
    expect(await counts(f.users.other.ctx)).toMatchObject({ requested: 2, accepted: 0 });
    const first = (
      (await staff.list(f.users.owner.ctx)).requests as { id: string; status: string }[]
    ).find((item) => item.status === 'requested')!;
    await staff.command(f.users.owner.ctx, {
      action: 'note',
      commandId: randomUUID(),
      requestId: first.id,
      expectedSeq: await seq(first.id),
      internalNote: 'Synthetic note that takes the request',
    });
    expect(await counts()).toMatchObject({ requested: 2, accepted: 1 });
    // The other team no longer sees the taken request, nor any request this team has quoted.
    const other = await counts(f.users.other.ctx);
    expect(other).toMatchObject({ requested: 1, accepted: 0 });
  });
});
