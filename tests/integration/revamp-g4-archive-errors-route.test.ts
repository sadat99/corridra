import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { harness, options, type Fixture } from './revamp-g4-support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerProgrammeLifecycle } from '../../packages/db/src/customer-programme-lifecycle-migrate';
import { migrateCustomerWorkspaceLifecycle } from '../../packages/db/src/customer-workspace-lifecycle-migrate';
import { admitSyntheticCustomerRequests } from '../../packages/auth/src/customer-request-admission';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';
import { MissionService } from '../../packages/missions/src/index';
import { CustomerRequestService } from '../../packages/auth/src/customer-requests';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerProgrammeService } from '../../packages/auth/src/customer-programmes';
import { CustomerParticipantService } from '../../packages/auth/src/customer-participants';

// CRUD G4, what a person is told. An archived workspace refuses new private requests, invitations and registrations in
// the database; through the real routes and services the person must read the archive wording with a 409 and the code
// archived, never the generic "please try again" 500. The services are the real ones on a real archived workspace.
const live = vi.hoisted(() => ({ services: undefined as unknown }));
vi.mock('../../apps/web/lib/foundations', () => ({ foundations: () => live.services }));
import * as requestsRoute from '../../apps/web/app/api/customer-requests/route';
import * as accessRoute from '../../apps/web/app/api/customer-workspace-access/route';
import * as participantsRoute from '../../apps/web/app/api/customer-programme-participants/route';

const origin = 'https://app.example.invalid';
const archivedText =
  'This workspace is archived. Restore it to send new private requests, invitations and registrations.';
const archivedOthersText =
  'This workspace is archived and is not accepting new invitations or registrations right now.';
const post = (path: string, body: unknown) =>
  new Request(origin + path, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
const brief = {
  objective: 'Sell in a new market',
  market: 'Spain',
  attendance: 'Yes',
  startDate: '2026-11-01',
  endDate: '2026-11-07',
  timezone: 'Europe/Madrid',
  offer: 'Synthetic hotel towels archive route',
  website: 'https://example.invalid/catalogue',
  outcomes: ['Relevant meetings'],
  notes: 'Synthetic test only',
  name: 'Test Person',
  company: 'Example Test Company',
  email: 'mission@example.invalid',
  acknowledged: true,
};

let f: Fixture;
let h: ReturnType<typeof harness>;
let missions: MissionService;
let person = 'alice';
const people = ['alice', 'bob', 'pat'];
const principals: Record<string, string> = {};

beforeAll(async () => {
  f = await fixture();
  missions = new MissionService(f.runtime, 'synthetic-only-route-secret');
  await migrateCustomerRealUse(f.owner);
  await migrateCustomerProgrammeLifecycle(f.owner);
  await migrateCustomerWorkspaceLifecycle(f.owner);
  h = harness(f, 'g4err');
  Object.assign(principals, await h.admit(people));
  for (const name of people)
    await admitSyntheticCustomerRequests(f.owner, {
      principalId: principals[name]!,
      reason: 'Explicit invented synthetic request scope, no commercial activation',
    });
  await configureSyntheticIntake(f.owner, f.tenantA, f.users.owner.id);
  await h.setControl(true);
  const session = async () => h.session(person);
  live.services = {
    ready: Promise.resolve(),
    config: { APP_ORIGIN: origin },
    missions: {
      budget: async () => undefined,
      prepareCustomerIntake: (
        context: Parameters<MissionService['prepareCustomerIntake']>[0],
        b: unknown,
      ) => missions.prepareCustomerIntake(context, b),
    },
    customerRequests: new CustomerRequestService(f.runtime, f.auth, options, session),
    customerWorkspaces: new CustomerWorkspaceService(f.runtime, f.auth, options, session),
    customerParticipants: new CustomerParticipantService(f.runtime, f.auth, options, session),
  };
});
afterAll(async () => {
  await f?.close();
});
beforeEach(() => {
  vi.stubEnv('DATA_ENVIRONMENT', 'synthetic');
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('CORRIDRA_CUSTOMER_WORKSPACES_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_CUSTOMER_REQUESTS_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_CUSTOMER_PROGRAMMES_ENABLED', 'true');
  vi.stubEnv('CORRIDRA_CUSTOMER_PARTICIPANTS_ENABLED', 'true');
});
afterEach(() => vi.unstubAllEnvs());

describe('an archived workspace, through the routes', () => {
  test('tells the person why a new request, an invitation, an acceptance and a programme registration were refused', async () => {
    person = 'alice';
    const name = 'Synthetic archive route workspace';
    const workspaceId = await h.provision('alice', name);
    const programmes = new CustomerProgrammeService(f.runtime, f.auth, options, async () =>
      h.session('alice'),
    );
    const programme = await programmes.create({
      commandId: randomUUID(),
      workspaceId,
      name: 'Synthetic archive route programme',
      reportingPurpose: 'Synthetic planning of a buyer visit for the archive route tests',
      acknowledged: true,
    });
    const memberInvite = await h.workspaces('alice').access({
      action: 'invite',
      commandId: randomUUID(),
      workspaceId,
      label: 'Synthetic invited before archive',
    });
    const issued = await new CustomerParticipantService(f.runtime, f.auth, options, async () =>
      h.session('alice'),
    ).command({
      action: 'invite',
      commandId: randomUUID(),
      workspaceId,
      programmeId: programme.id,
      label: 'Synthetic invitation before archive',
      acknowledged: true,
    });
    await h.lifecycle('alice', 'archive', { workspaceId, expectedVersion: 0, confirmName: name });
    const before = (
      await f.owner.query(
        `SELECT (SELECT count(*)::int FROM customer_private.owned_request WHERE workspace_id=$1) requests,
         (SELECT count(*)::int FROM customer_private.workspace_invitation WHERE tenant_id=$1) invitations,
         (SELECT count(*)::int FROM customer_private.programme_invitation WHERE workspace_id=$1) programme_invitations,
         (SELECT count(*)::int FROM customer_private.programme_registration WHERE workspace_id=$1) registrations`,
        [workspaceId],
      )
    ).rows[0];
    const refused = async (response: Response, text: string) => {
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: text, code: 'archived' });
      expect(response.headers.get('cache-control')).toBe('no-store');
    };

    await refused(
      await requestsRoute.POST(
        post('/api/customer-requests', { commandId: randomUUID(), workspaceId, brief }),
      ),
      archivedText,
    );
    await refused(
      await accessRoute.POST(
        post('/api/customer-workspace-access', {
          action: 'invite',
          commandId: randomUUID(),
          workspaceId,
          label: 'Synthetic invited while archived',
        }),
      ),
      archivedText,
    );
    person = 'pat';
    await refused(
      await accessRoute.POST(
        post('/api/customer-workspace-access', {
          action: 'accept',
          commandId: randomUUID(),
          token: memberInvite.token,
        }),
      ),
      archivedOthersText,
    );
    await refused(
      await participantsRoute.POST(
        post('/api/customer-programme-participants', {
          action: 'accept',
          commandId: randomUUID(),
          token: issued.token,
          programmeId: programme.id,
          displayLabel: 'Synthetic participant Pat',
          consented: true,
        }),
      ),
      archivedOthersText,
    );
    await refused(
      await participantsRoute.POST(
        post('/api/customer-programme-participants', { action: 'preview', token: issued.token }),
      ),
      archivedOthersText,
    );
    person = 'alice';
    await refused(
      await participantsRoute.POST(
        post('/api/customer-programme-participants', {
          action: 'invite',
          commandId: randomUUID(),
          workspaceId,
          programmeId: programme.id,
          label: 'Synthetic invitation while archived',
          acknowledged: true,
        }),
      ),
      archivedText,
    );
    expect(
      (
        await f.owner.query(
          `SELECT (SELECT count(*)::int FROM customer_private.owned_request WHERE workspace_id=$1) requests,
           (SELECT count(*)::int FROM customer_private.workspace_invitation WHERE tenant_id=$1) invitations,
           (SELECT count(*)::int FROM customer_private.programme_invitation WHERE workspace_id=$1) programme_invitations,
           (SELECT count(*)::int FROM customer_private.programme_registration WHERE workspace_id=$1) registrations`,
          [workspaceId],
        )
      ).rows[0],
    ).toEqual(before);
  });

  test('a refusal that is not about an archive keeps the generic answer', async () => {
    person = 'alice';
    const response = await requestsRoute.POST(
      post('/api/customer-requests', { commandId: randomUUID(), workspaceId: randomUUID(), brief }),
    );
    expect(response.status).not.toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain('archived');
  });
});
