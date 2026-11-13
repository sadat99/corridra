import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { missionDraftObjectives } from '../../packages/domain/src/mission-drafts';
import { fixture } from './support';
import { migrateCustomerAuthority } from '../../packages/db/src/customer-migrate';
import { migrateCustomerOrganisationProfiles } from '../../packages/db/src/customer-organisation-profile-migrate';
import { migrateCustomerMissionDrafts } from '../../packages/db/src/customer-mission-draft-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import {
  CustomerWorkspaceService,
  type CustomerSession,
} from '../../packages/auth/src/customer-workspaces';
import { admitSyntheticCustomerRequests } from '../../packages/auth/src/customer-request-admission';
import {
  CustomerMissionDraftService,
  type MissionDraftDetails,
} from '../../packages/auth/src/customer-mission-drafts';

// L16 read cost, measured on a real database: what the sidebar's journey counts add to a signed-in page that does not
// already read the work list. It counts the SQL statements the real workspace and draft services run for one
// loadWorkItems call (the whole cost of the counts), and prints the time. The count is asserted, the time is only reported.
vi.mock('../../packages/auth/src/customer-workspaces.ts', async (original) => ({
  ...(await original<object>()),
  customerWorkspacesEnabled: () => true,
}));
vi.mock('../../packages/auth/src/customer-mission-drafts.ts', async (original) => ({
  ...(await original<object>()),
  customerMissionDraftsEnabled: () => true,
}));
vi.mock('../../packages/auth/src/customer-requests.ts', async (original) => ({
  ...(await original<object>()),
  customerRequestsEnabled: () => false,
}));
vi.mock('../../packages/auth/src/customer-programmes.ts', async (original) => ({
  ...(await original<object>()),
  customerProgrammesEnabled: () => false,
}));
vi.mock('../../packages/auth/src/customer-service-requests.ts', async (original) => ({
  ...(await original<object>()),
  customerServiceRequestsEnabled: () => false,
}));

const issuer = 'https://ep-sidebar-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
const subject = 'synthetic-sidebar-alice';
const session = (): CustomerSession => ({
  subject,
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
let f: Awaited<ReturnType<typeof fixture>>;
let statements = 0;
let services: Record<string, unknown> | null = null;
vi.mock('../../apps/web/lib/foundations', () => ({ foundations: () => services }));

function count(pool: { query: unknown; connect: unknown }) {
  const query = (pool as { query: (...a: unknown[]) => unknown }).query.bind(pool);
  (pool as { query: unknown }).query = (...a: unknown[]) => {
    statements++;
    return query(...a);
  };
  const connect = (pool as { connect: (...a: unknown[]) => Promise<unknown> }).connect.bind(pool);
  (pool as { connect: unknown }).connect = async (...a: unknown[]) => {
    const client = (await connect(...a)) as { query: (...q: unknown[]) => unknown } | undefined;
    if (client && !(client as { counted?: boolean }).counted) {
      const q = client.query.bind(client);
      client.query = (...args: unknown[]) => {
        statements++;
        return q(...args);
      };
      (client as { counted?: boolean }).counted = true;
    }
    return client;
  };
}

beforeAll(async () => {
  f = await fixture('corridra_integration');
  await migrateCustomerAuthority(f.owner);
  await migrateCustomerOrganisationProfiles(f.owner);
  await migrateCustomerMissionDrafts(f.owner);
  const admitted = await admitSyntheticCustomer(f.owner, {
    issuer,
    subject,
    executorId: f.serviceId,
    reason: 'Explicit invented sidebar read-cost identity; no real account or email',
  });
  await admitSyntheticCustomerRequests(f.owner, {
    principalId: admitted.id,
    reason: 'Explicit invented synthetic request scope, no commercial activation',
  });
  const workspaces = new CustomerWorkspaceService(f.runtime, f.auth, options, async () =>
    session(),
  );
  const drafts = new CustomerMissionDraftService(f.runtime, f.auth, options, async () => session());
  const ids: string[] = [];
  for (const name of ['one', 'two', 'three'])
    ids.push(
      (
        await workspaces.provision({
          commandId: randomUUID(),
          name: `Synthetic sidebar measurement workspace ${name}`,
        })
      ).id,
    );
  const families = ['SUPPLIERS_PRODUCTS', 'BUYERS_PARTNERS', 'DELEGATION'];
  for (const id of ids)
    for (let n = 0; n < 6; n++)
      await drafts.save({
        commandId: randomUUID(),
        workspaceId: id,
        draftId: null,
        expectedVersion: 0,
        details: details(families[n % 3]!, n),
        acknowledged: true as const,
      });
  services = {
    ready: Promise.resolve(),
    customerWorkspaces: workspaces,
    customerMissionDrafts: drafts,
  };
  count(f.runtime);
  count(f.auth);
});
afterAll(async () => {
  await f.owner.end();
});

test('loadWorkItems for a person with three workspaces runs a small, fixed number of statements', async () => {
  const { loadWorkItems } = await import('../../apps/web/lib/work-items/load');
  statements = 0;
  const cold = performance.now();
  let list = await loadWorkItems(subject, issuer);
  const coldMs = performance.now() - cold;
  const first = statements;
  const times: number[] = [];
  for (let n = 0; n < 5; n++) {
    const started = performance.now();
    list = await loadWorkItems(subject, issuer);
    times.push(performance.now() - started);
  }
  times.sort((x, y) => x - y);
  console.log(
    `L16 read cost: ${first} SQL statements per call, first call ${coldMs.toFixed(1)} ms, warm median ${times[2]!.toFixed(1)} ms over 5 calls, ${list.items.length} items in 3 workspaces`,
  );
  expect(list.unreadable).toEqual([]);
  expect(list.workspaces).toHaveLength(3);
  expect(first).toBeGreaterThan(0);
  expect(first).toBeLessThanOrEqual(60);
});

const details = (family: string, n: number): MissionDraftDetails => ({
  title: `Synthetic measurement draft ${n}`,
  family,
  objective: missionDraftObjectives[family as keyof typeof missionDraftObjectives][0]!,
  market: 'Spain',
  attendance: 'Yes',
  startDate: '2026-11-01',
  endDate: '2026-11-07',
  timezone: 'Europe/Madrid',
  offer: 'Synthetic hotel towels made in Bangladesh',
  website: 'https://towels.example',
  outcomes: ['Relevant meetings'],
  notes: '',
  requirements: [{ label: 'Event or fair', value: 'Synthetic Home Textiles fair in Madrid' }],
  contactName: 'Test Person',
  contactEmail: 'mission@example.invalid',
  profileVersion: null,
  sourcingContext: null,
  companyName: 'Synthetic Dhaka Towels Limited',
});
