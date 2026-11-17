import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { migrateCustomerAuthority } from '../../packages/db/src/customer-migrate';
import { migrateCustomerOrganisationProfiles } from '../../packages/db/src/customer-organisation-profile-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import {
  CustomerWorkspaceService,
  type CustomerSession,
} from '../../packages/auth/src/customer-workspaces';
import { CustomerOrganisationProfileService } from '../../packages/auth/src/customer-organisation-profiles';
import type { DatabaseClient, DatabasePool } from '../../packages/db/src/index';

// CI-U2 on the real restricted SQL logins: the commercial facts reader goes only through the existing
// session-checked workspace and profile readers, so row security and current membership decide what it sees.
// Invented provider sessions; this proves no managed-provider or email acceptance.
vi.mock('server-only', () => ({}));
const issuer = 'https://ep-facts-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
vi.mock('../../packages/config/src/index.ts', () => ({
  readNeonAuthConfig: () => ({ NEON_AUTH_BASE_URL: issuer }),
}));
const subject = (person: string) => 'synthetic-facts-' + person;
let current = 'alice';
vi.mock('../../apps/web/lib/neon-auth', () => ({
  neonAuth: () => ({
    getSession: async () => ({
      data: {
        user: {
          id: subject(current),
          name: `Synthetic ${current}`,
          email: `${current}@facts.example`,
          emailVerified: true,
        },
      },
      error: null,
    }),
  }),
}));
vi.mock('../../apps/web/lib/work-items/load', () => ({
  loadWorkItems: async () => ({
    items: [],
    unreadable: [],
    partial: false,
    skippedWorkspaces: 0,
    workspaces: [],
  }),
}));

let f: Awaited<ReturnType<typeof fixture>>;
let services: Record<string, unknown> | null = null;
vi.mock('../../apps/web/lib/foundations', () => ({ foundations: () => services }));

// Every statement either pool receives, so the test can see that the reader itself sends no write.
const statements: string[] = [];
function recording(pool: DatabasePool): DatabasePool {
  const note = (text: unknown) =>
    statements.push(
      (typeof text === 'string' ? text : String((text as { text?: string }).text))
        .replace(/\s+/g, ' ')
        .trim(),
    );
  return {
    query: ((text: unknown, ...rest: unknown[]) => {
      note(text);
      return (pool.query as (...args: unknown[]) => unknown)(text, ...rest);
    }) as DatabasePool['query'],
    end: () => pool.end(),
    connect: async () => {
      const client = await pool.connect();
      return {
        release: (...args: Parameters<DatabaseClient['release']>) => client.release(...args),
        query: ((text: unknown, ...rest: unknown[]) => {
          note(text);
          return (client.query as (...args: unknown[]) => unknown)(text, ...rest);
        }) as DatabaseClient['query'],
      } as DatabaseClient;
    },
  };
}
const session = (): CustomerSession => ({
  subject: subject(current),
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const raw = (person: string) => ({
  workspaces: new CustomerWorkspaceService(f.runtime, f.auth, options, async () => ({
    ...session(),
    subject: subject(person),
  })),
  profiles: new CustomerOrganisationProfileService(f.runtime, f.auth, options, async () => ({
    ...session(),
    subject: subject(person),
  })),
});
const details = {
  A: {
    legalName: 'Synthetic Dhaka Knit Limited',
    countryCode: 'BD',
    website: 'https://knit.example',
    commercialRoles: ['SELLER', 'MANUFACTURER'],
    sectors: ['Knitwear'],
    sizeBand: '201-1000',
    summary: 'Synthetic knitwear exporter for European buyers',
  },
  B: {
    legalName: 'Synthetic Singapore Buying Office Pte Ltd',
    countryCode: 'SG',
    website: 'https://buying.test',
    commercialRoles: ['BUYER'],
    sectors: ['Footwear', 'Leather goods'],
    sizeBand: '11-50',
    summary: 'Synthetic buying office for footwear and leather goods',
  },
};
let A: string, B: string, C: string;
const mod = () => import('../../apps/web/lib/commercial-identity/facts');
async function factsAs(person: string, workspaceId: string) {
  current = person;
  const { readCommercialActor, loadCommercialFacts } = await mod();
  const actor = await readCommercialActor();
  if (!actor) throw new Error('no actor');
  return loadCommercialFacts({ actor, workspaceId });
}
const strings = (value: unknown): string[] =>
  typeof value === 'string'
    ? [value]
    : Array.isArray(value)
      ? value.flatMap(strings)
      : value && typeof value === 'object'
        ? Object.values(value).flatMap(strings)
        : [];

beforeAll(async () => {
  process.env.CORRIDRA_CUSTOMER_WORKSPACES_ENABLED = 'true';
  process.env.CORRIDRA_CUSTOMER_ORGANISATION_PROFILES_ENABLED = 'true';
  process.env.DATA_ENVIRONMENT = 'synthetic';
  f = await fixture();
  await migrateCustomerAuthority(f.owner);
  await migrateCustomerOrganisationProfiles(f.owner);
  for (const person of ['alice', 'bob', 'carol', 'outsider'])
    await admitSyntheticCustomer(f.owner, {
      issuer,
      subject: subject(person),
      executorId: f.serviceId,
      reason: 'Explicit invented commercial facts test identity; no real account or email',
    });
  // Alice owns A and is a plain member of B (owned by Carol). Bob is a member of A only. C is Carol's alone.
  A = (
    await raw('alice').workspaces.provision({
      commandId: randomUUID(),
      name: 'Synthetic knit workspace',
    })
  ).id;
  B = (
    await raw('carol').workspaces.provision({
      commandId: randomUUID(),
      name: 'Synthetic buying workspace',
    })
  ).id;
  C = (
    await raw('carol').workspaces.provision({
      commandId: randomUUID(),
      name: 'Synthetic private workspace',
    })
  ).id;
  const join = async (owner: string, workspaceId: string, person: string) => {
    const invitation = await raw(owner).workspaces.access({
      action: 'invite',
      commandId: randomUUID(),
      workspaceId,
      label: 'Synthetic facts member',
    });
    await raw(person).workspaces.access({
      action: 'accept',
      commandId: randomUUID(),
      token: invitation.token,
    });
  };
  await join('alice', A, 'bob');
  await join('carol', B, 'alice');
  const write = (person: string, workspaceId: string, expectedVersion: number, body: object) =>
    raw(person).profiles.command({
      commandId: randomUUID(),
      workspaceId,
      expectedVersion,
      reason: 'Synthetic facts revision',
      acknowledged: true,
      ...body,
    });
  await write('alice', A, 0, details.A);
  await write('alice', A, 1, {
    ...details.A,
    summary: 'Synthetic knitwear exporter, second revision',
  });
  await write('carol', B, 0, details.B);
  // A shared runtime and auth pool behind every service the reader can reach, recording each statement.
  const runtime = recording(f.runtime);
  const auth = recording(f.auth);
  services = {
    ready: Promise.resolve(),
    customerWorkspaces: new CustomerWorkspaceService(runtime, auth, options, async () => session()),
    customerOrganisationProfiles: new CustomerOrganisationProfileService(
      runtime,
      auth,
      options,
      async () => session(),
    ),
  };
});
afterAll(async () => {
  await f?.close();
});

test('facts for A carry the newest self-reported revision and no value of B', async () => {
  const result = await factsAs('alice', A);
  if (!result.ok) throw new Error(result.code);
  const value = (key: string) => result.facts.find((fact) => fact.key === key);
  expect(value('organisation.summary')).toMatchObject({
    value: 'Synthetic knitwear exporter, second revision',
    provenance: 'SELF_REPORTED',
    source: { kind: 'organisation_profile_revision', id: A, version: 2 },
  });
  expect(value('membership.role')).toMatchObject({ value: 'owner', provenance: 'MEMBERSHIP' });
  const forbidden = new Set([
    ...strings(details.B),
    B,
    C,
    'Synthetic buying workspace',
    'Synthetic private workspace',
  ]);
  for (const text of strings(result)) expect(forbidden.has(text), `A leaks ${text}`).toBe(false);
});

test('the same person reading B as a member sees only B, with the member role', async () => {
  const result = await factsAs('alice', B);
  if (!result.ok) throw new Error(result.code);
  expect(result.facts.find((fact) => fact.key === 'membership.role')?.value).toBe('member');
  expect(result.facts.find((fact) => fact.key === 'organisation.legalName')?.value).toBe(
    details.B.legalName,
  );
  const forbidden = new Set([
    ...strings(details.A),
    'Synthetic knitwear exporter, second revision',
    A,
  ]);
  for (const text of strings(result)) expect(forbidden.has(text), `B leaks ${text}`).toBe(false);
  expect(result.absent).toContainEqual({
    key: 'representation.authority',
    reason: 'not_established',
    workspaceId: B,
  });
});

test('a workspace the person does not belong to is refused, for a member and an outsider alike', async () => {
  expect(await factsAs('alice', C)).toMatchObject({
    ok: false,
    code: 'not_a_member',
    workspaceId: C,
  });
  expect(await factsAs('bob', B)).toMatchObject({ ok: false, code: 'not_a_member' });
  expect(await factsAs('outsider', A)).toMatchObject({ ok: false, code: 'not_a_member' });
  expect(await factsAs('outsider', randomUUID())).toMatchObject({
    ok: false,
    code: 'not_a_member',
  });
});

test('representable workspaces are the current memberships with role only', async () => {
  current = 'alice';
  const { readCommercialActor, listRepresentableWorkspaces } = await mod();
  const result = await listRepresentableWorkspaces((await readCommercialActor())!);
  if (!result.ok) throw new Error(result.code);
  expect(result.workspaces.map((w) => [w.workspaceId, w.role]).sort()).toEqual(
    [
      [A, 'owner'],
      [B, 'member'],
    ].sort(),
  );
});

test('a membership revoked between the workspace list and the profile read fails closed', async () => {
  const invitation = await raw('carol').workspaces.access({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId: C,
    label: 'Synthetic racing member',
  });
  await raw('bob').workspaces.access({
    action: 'accept',
    commandId: randomUUID(),
    token: invitation.token,
  });
  const before = services!;
  const real = before.customerWorkspaces as CustomerWorkspaceService;
  services = {
    ...before,
    customerWorkspaces: {
      // The real list read, then the owner removes Bob before the profile read runs.
      list: async (...args: Parameters<CustomerWorkspaceService['list']>) => {
        const listed = await real.list(...args);
        const page = await raw('carol').workspaces.listAccess({ workspaceId: C });
        const membership = page.memberships.find((m) => m.status === 'active');
        await raw('carol').workspaces.access({
          action: 'revoke',
          commandId: randomUUID(),
          workspaceId: C,
          kind: 'membership',
          targetId: membership!.id,
        });
        return listed;
      },
    },
  };
  try {
    const result = await factsAs('bob', C);
    expect(result).toEqual({
      ok: false,
      code: 'not_a_member',
      message: expect.any(String),
      workspaceId: C,
    });
  } finally {
    services = before;
  }
});

test('the signed-in account changing mid-call is refused as session_changed', async () => {
  const before = services!;
  const real = before.customerWorkspaces as CustomerWorkspaceService;
  services = {
    ...before,
    customerWorkspaces: {
      // The real list read as Alice; then the provider session becomes Carol's before the profile read.
      list: async (...args: Parameters<CustomerWorkspaceService['list']>) => {
        const listed = await real.list(...args);
        current = 'carol';
        return listed;
      },
    },
  };
  try {
    const result = await factsAs('alice', A);
    expect(result).toEqual({
      ok: false,
      code: 'session_changed',
      message: expect.any(String),
      workspaceId: A,
    });
  } finally {
    services = before;
  }
});

test('a removed member loses the facts at once', async () => {
  const before = await factsAs('bob', A);
  expect(before.ok).toBe(true);
  const page = await raw('alice').workspaces.listAccess({ workspaceId: A });
  const membership = page.memberships.find((m) => m.status === 'active');
  await raw('alice').workspaces.access({
    action: 'revoke',
    commandId: randomUUID(),
    workspaceId: A,
    kind: 'membership',
    targetId: membership!.id,
  });
  expect(await factsAs('bob', A)).toMatchObject({ ok: false, code: 'not_a_member' });
});

test('the reader sends no write of its own beyond the boundary session proof', async () => {
  statements.length = 0;
  await factsAs('alice', A);
  await factsAs('alice', B);
  const writes = statements.filter((s) => /^(INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b/i.test(s));
  // The shared session boundary records and removes its own short proof on every read; nothing else writes.
  for (const statement of writes) expect(statement).toMatch(/customer_private\.session_proof/);
  const calls = statements.filter(
    (s) => /customer\.|customer_private\./.test(s) && /^SELECT/i.test(s),
  );
  for (const statement of calls)
    expect(statement).not.toMatch(
      /_command\(|organisation_profile_history|access_command|provision/,
    );
});
