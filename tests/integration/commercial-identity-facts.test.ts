import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// CI-U2: the read-only commercial facts service (apps/web/lib/commercial-identity). It returns the facts the
// signed-in person may reuse for ONE workspace they chose, each with its source, provenance and time, and says
// plainly what is missing instead of inventing it. It never writes, never reads another workspace and never
// turns a self-reported statement, a verified email or a membership role into a verified fact.
vi.mock('server-only', () => ({}));

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const OUTSIDE = '99999999-9999-4999-8999-999999999999';
const issuer = 'https://ep-facts.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';

const on = { workspaces: true, profiles: true };
vi.mock('../../packages/auth/src/customer-workspaces.ts', () => ({
  customerWorkspacesEnabled: () => on.workspaces,
}));
vi.mock('../../packages/auth/src/customer-organisation-profiles.ts', () => ({
  customerOrganisationProfilesEnabled: () => on.profiles,
}));
vi.mock('../../packages/config/src/index.ts', () => ({
  readNeonAuthConfig: () => ({ NEON_AUTH_BASE_URL: issuer }),
}));

type ProviderUser = { id: string; name?: string | null; email?: string; emailVerified?: boolean };
let provider: { user: ProviderUser | null; error?: unknown } = {
  user: {
    id: 'subject-1',
    name: 'Nadia Rahman',
    email: 'nadia@atelier.example',
    emailVerified: true,
  },
};
const providerReads: unknown[] = [];
vi.mock('../../apps/web/lib/neon-auth', () => ({
  neonAuth: () => ({
    getSession: async (options: unknown) => {
      providerReads.push(options);
      return provider.error
        ? { data: null, error: provider.error }
        : { data: provider.user ? { user: provider.user } : null, error: null };
    },
  }),
}));

const profileA = {
  legalName: 'Synthetic Atelier Rahman Limited',
  countryCode: 'BD',
  website: 'https://atelier.example',
  commercialRoles: ['SELLER', 'MANUFACTURER'],
  sectors: ['Knitwear', 'Denim'],
  sizeBand: '201-1000',
  summary: 'Synthetic exporter of knitwear for European buyers',
  version: 3,
  updatedAt: '2026-11-10T09:00:00.000Z',
  reason: 'private change reason that must never be reused',
};
const profileB = {
  legalName: 'Synthetic Singapore Sourcing Pte Ltd',
  countryCode: 'SG',
  website: 'https://sourcing.test',
  commercialRoles: ['BUYER', 'DISTRIBUTOR'],
  sectors: ['Footwear'],
  sizeBand: '11-50',
  summary: 'Synthetic buying office for footwear in Asia',
  version: 7,
  updatedAt: '2026-11-12T09:00:00.000Z',
};
const view = (workspaceId: string, profile: Record<string, unknown> | null) => ({
  workspaceId,
  expiresAt: '2026-11-17T12:00:00.000Z',
  organisationId: null,
  canonicalLinked: false,
  provenance: 'SELF_REPORTED',
  verified: false,
  canEdit: true,
  currentVersion: profile ? (profile.version as number) : 0,
  profile,
});

type Role = 'owner' | 'admin' | 'member';
let memberships: { id: string; name: string; role: Role; archived?: boolean }[];
let profiles: Record<string, Record<string, unknown> | null>;
let workItems: {
  items: { workspaceId: string; family: string; title: string; status: string; id: string }[];
  unreadable: string[];
  partial: boolean;
};
const calls: string[] = [];
const subjects: unknown[] = [];

// Every service the facts reader can reach records the method it called. Anything not on the read list throws,
// so a write (command, accept, revoke, invite ...) can never pass silently.
const allowed = new Set(['customerWorkspaces.list', 'customerOrganisationProfiles.view']);
function guarded(name: string, impl: Record<string, (...args: never[]) => unknown>) {
  return new Proxy(impl, {
    get(target, prop) {
      if (typeof prop !== 'string' || prop === 'then') return undefined;
      const key = `${name}.${prop}`;
      return (...args: unknown[]) => {
        calls.push(key);
        if (!allowed.has(key)) throw new Error(`Unexpected call ${key}`);
        return (target[prop] as (...a: unknown[]) => unknown)(...args);
      };
    },
  });
}
let services: Record<string, unknown> | null;
function healthy() {
  return {
    ready: Promise.resolve(),
    customerWorkspaces: guarded('customerWorkspaces', {
      list: async (subject: string, iss: string) => {
        subjects.push([subject, iss]);
        if (subject !== provider.user?.id)
          throw Object.assign(new Error('changed'), { status: 409 });
        return memberships.map((m) => ({
          ...m,
          synthetic: true,
          organisationId: null,
          archived: !!m.archived,
        }));
      },
    }),
    customerOrganisationProfiles: guarded('customerOrganisationProfiles', {
      view: async (input: { workspaceId: string }, subject: string) => {
        subjects.push([input, subject]);
        if (!memberships.some((m) => m.id === input.workspaceId))
          throw Object.assign(new Error('denied'), { status: 403 });
        return view(input.workspaceId, profiles[input.workspaceId] ?? null);
      },
    }),
  };
}
vi.mock('../../apps/web/lib/foundations', () => ({ foundations: () => services }));
vi.mock('../../apps/web/lib/work-items/load', () => ({
  loadWorkItems: async (subject: string) => {
    calls.push('workItems.load');
    subjects.push([subject]);
    return { ...workItems, skippedWorkspaces: 0, workspaces: [] };
  },
}));

const mod = () => import('../../apps/web/lib/commercial-identity/facts');
async function actor() {
  const { readCommercialActor } = await mod();
  const value = await readCommercialActor();
  if (!value) throw new Error('expected an actor');
  return value;
}
async function factsFor(workspaceId: string) {
  const { loadCommercialFacts } = await mod();
  return loadCommercialFacts({ actor: await actor(), workspaceId });
}
const present = (result: Awaited<ReturnType<typeof factsFor>>) => {
  if (!result.ok) throw new Error(`refused: ${result.code}`);
  return result;
};
const strings = (value: unknown): string[] =>
  typeof value === 'string'
    ? [value]
    : Array.isArray(value)
      ? value.flatMap(strings)
      : value && typeof value === 'object'
        ? Object.values(value).flatMap(strings)
        : [];

beforeEach(() => {
  Object.assign(on, { workspaces: true, profiles: true });
  provider = {
    user: {
      id: 'subject-1',
      name: 'Nadia Rahman',
      email: 'nadia@atelier.example',
      emailVerified: true,
    },
  };
  memberships = [
    { id: A, name: 'Atelier Rahman', role: 'owner' },
    { id: B, name: 'Singapore Sourcing', role: 'member' },
  ];
  profiles = { [A]: profileA, [B]: profileB };
  workItems = {
    items: [
      { workspaceId: A, family: 'SELL', title: 'A secret title', status: 'OPEN', id: 'a1' },
      { workspaceId: A, family: 'UNCLASSIFIED', title: 'Other', status: 'OPEN', id: 'a2' },
      { workspaceId: B, family: 'SOURCE', title: 'B secret title', status: 'OPEN', id: 'b1' },
      { workspaceId: B, family: 'ORGANISE', title: 'B trip', status: 'OPEN', id: 'b2' },
    ],
    unreadable: [],
    partial: false,
  };
  services = healthy();
  calls.length = 0;
  subjects.length = 0;
  providerReads.length = 0;
});

describe('actor comes only from the server-side session', () => {
  it('reads the fresh provider session, bypassing the cookie cache', async () => {
    const value = await actor();
    expect(value.subject).toBe('subject-1');
    expect(value.issuer).toBe(issuer);
    expect(providerReads).toEqual([{ query: { disableCookieCache: true } }]);
  });

  it('refuses a hand-made actor object, even one naming a real member', async () => {
    const { loadCommercialFacts, listRepresentableWorkspaces } = await mod();
    const forged = {
      subject: 'subject-1',
      issuer,
      name: 'Nadia Rahman',
      email: 'nadia@atelier.example',
      emailVerified: true,
    };
    const facts = await loadCommercialFacts({ actor: forged as never, workspaceId: A });
    expect(facts).toMatchObject({ ok: false, code: 'actor_not_from_session' });
    const list = await listRepresentableWorkspaces(forged as never);
    expect(list).toMatchObject({ ok: false, code: 'actor_not_from_session' });
    expect(calls).toEqual([]);
  });

  it('cannot construct an actor outside the module', async () => {
    const { CommercialActor } = await mod();
    expect(
      () =>
        new (CommercialActor as unknown as new (...a: unknown[]) => unknown)(
          Symbol('x'),
          'subject-2',
          issuer,
        ),
    ).toThrow();
  });

  it('is null when nobody is signed in, the email is unverified or the provider fails', async () => {
    const { readCommercialActor } = await mod();
    provider = { user: null };
    expect(await readCommercialActor()).toBeNull();
    provider = { user: { id: 'subject-1', email: 'x@atelier.example', emailVerified: false } };
    expect(await readCommercialActor()).toBeNull();
    provider = { user: null, error: new Error('down') };
    expect(await readCommercialActor()).toBeNull();
  });

  it('passes only the session subject and issuer on, as rejection-only expectations', async () => {
    present(await factsFor(A));
    for (const entry of subjects)
      expect(strings(entry).filter((s) => s.startsWith('subject-'))).toEqual(['subject-1']);
  });

  it('a session that changed since the actor was read is refused, not served', async () => {
    const value = await actor();
    provider = { user: { id: 'subject-2', email: 'someone@else.example', emailVerified: true } };
    const { loadCommercialFacts } = await mod();
    expect(await loadCommercialFacts({ actor: value, workspaceId: A })).toMatchObject({
      ok: false,
      code: 'session_changed',
    });
  });

  it('takes no parameter other than the actor and one workspace', async () => {
    const { loadCommercialFacts } = await mod();
    const result = await loadCommercialFacts({
      actor: await actor(),
      workspaceId: A,
      subject: 'subject-2',
    } as never);
    expect(result).toMatchObject({ ok: false, code: 'invalid_request' });
    expect(calls).toEqual([]);
  });
});

describe('workspace scope', () => {
  it('lists representable workspaces with role only', async () => {
    const { listRepresentableWorkspaces } = await mod();
    const result = await listRepresentableWorkspaces(await actor());
    expect(result).toEqual({
      ok: true,
      workspaces: [
        { workspaceId: A, name: 'Atelier Rahman', role: 'owner', archived: false },
        { workspaceId: B, name: 'Singapore Sourcing', role: 'member', archived: false },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(/authori[sz]ed|represent/i);
  });

  it('a workspace the actor is not a member of is a typed refusal, not an empty list', async () => {
    const result = await factsFor(OUTSIDE);
    expect(result).toEqual({
      ok: false,
      code: 'not_a_member',
      message: expect.any(String),
      workspaceId: OUTSIDE,
    });
    expect(calls).toEqual(['customerWorkspaces.list']);
  });

  it('a malformed workspace id is refused before any read', async () => {
    expect(await factsFor('not-a-uuid')).toMatchObject({ ok: false, code: 'invalid_request' });
    expect(calls).toEqual([]);
  });

  it('facts for A never contain a value of B, on any field, and the reverse', async () => {
    const a = present(await factsFor(A));
    const b = present(await factsFor(B));
    const bValues = new Set([
      ...strings(profileB),
      B,
      'SOURCE',
      'ORGANISE',
      'Singapore Sourcing',
      'member',
    ]);
    const aValues = new Set([...strings(profileA), A, 'SELL', 'Atelier Rahman', 'owner']);
    for (const value of strings(a)) expect(bValues.has(value), `A leaks ${value}`).toBe(false);
    for (const value of strings(b)) expect(aValues.has(value), `B leaks ${value}`).toBe(false);
    for (const fact of [...a.facts, ...a.absent]) expect(fact.workspaceId).toBe(A);
    for (const fact of [...b.facts, ...b.absent]) expect(fact.workspaceId).toBe(B);
    expect(a.workspaceId).toBe(A);
  });

  it('never returns the profile change reason, work titles, statuses or ids', async () => {
    const text = JSON.stringify(present(await factsFor(A)));
    for (const hidden of [
      'private change reason',
      'A secret title',
      'a1',
      'a2',
      'OPEN',
      'UNCLASSIFIED',
    ])
      expect(text).not.toContain(hidden);
  });

  it('a profile view answering for another workspace is refused, never relabelled', async () => {
    services = {
      ...healthy(),
      customerOrganisationProfiles: guarded('customerOrganisationProfiles', {
        view: async () => view(B, profileB),
      }),
    };
    const result = await factsFor(A);
    expect(result).toMatchObject({ ok: false, code: 'unavailable' });
    expect(JSON.stringify(result)).not.toContain(profileB.legalName);
  });

  it('holds no state between calls: a removed membership is refused on the next call', async () => {
    present(await factsFor(A));
    memberships = memberships.filter((m) => m.id !== A);
    expect(await factsFor(A)).toMatchObject({ ok: false, code: 'not_a_member' });
  });
});

describe('representation is role only', () => {
  for (const role of ['owner', 'admin', 'member'] as const)
    it(`a ${role} gets the role and no authority to represent`, async () => {
      memberships = [{ id: A, name: 'Atelier Rahman', role }];
      const result = present(await factsFor(A));
      const roleFact = result.facts.find((f) => f.key === 'membership.role');
      expect(roleFact).toMatchObject({
        value: role,
        provenance: 'MEMBERSHIP',
        source: { kind: 'workspace_membership', id: A, version: null },
      });
      expect(result.facts.map((f) => f.key)).not.toContain('representation.authority');
      expect(result.absent).toContainEqual({
        key: 'representation.authority',
        reason: 'not_established',
        workspaceId: A,
      });
      expect(JSON.stringify(result.facts)).not.toMatch(/authori[sz]ed/i);
    });
});

describe('provenance', () => {
  it('profile facts are self-reported, with the newest version in the source', async () => {
    const result = present(await factsFor(A));
    const profileFacts = result.facts.filter((f) => f.key.startsWith('organisation.'));
    expect(profileFacts.map((f) => f.key).sort()).toEqual([
      'organisation.commercialRoles',
      'organisation.countryCode',
      'organisation.legalName',
      'organisation.sectors',
      'organisation.sizeBand',
      'organisation.summary',
      'organisation.website',
    ]);
    for (const fact of profileFacts)
      expect(fact).toMatchObject({
        provenance: 'SELF_REPORTED',
        source: { kind: 'organisation_profile_revision', id: A, version: 3 },
        asOf: '2026-11-10T09:00:00.000Z',
      });
    expect(result.facts.find((f) => f.key === 'organisation.legalName')?.value).toBe(
      profileA.legalName,
    );
    expect(result.facts.find((f) => f.key === 'organisation.commercialRoles')?.value).toEqual([
      'SELLER',
      'MANUFACTURER',
    ]);
  });

  it('a newer profile version is returned with that version', async () => {
    profiles[A] = {
      ...profileA,
      legalName: 'Synthetic Atelier Rahman Group',
      version: 4,
      updatedAt: '2026-11-15T09:00:00.000Z',
    };
    const result = present(await factsFor(A));
    const name = result.facts.find((f) => f.key === 'organisation.legalName');
    expect(name).toMatchObject({
      value: 'Synthetic Atelier Rahman Group',
      source: { version: 4 },
      asOf: '2026-11-15T09:00:00.000Z',
    });
  });

  it('a self-reported value is never labelled verified, even when the view says so', async () => {
    services = {
      ...healthy(),
      customerOrganisationProfiles: guarded('customerOrganisationProfiles', {
        view: async (input: { workspaceId: string }) => ({
          ...view(input.workspaceId, profileA),
          provenance: 'VERIFIED',
          verified: true,
        }),
      }),
    };
    const result = present(await factsFor(A));
    for (const fact of result.facts.filter((f) => f.key.startsWith('organisation.')))
      expect(fact.provenance).toBe('SELF_REPORTED');
    for (const fact of result.facts) expect(fact.provenance).not.toBe('VERIFIED');
    expect(JSON.stringify(result)).not.toMatch(/"verified":true/);
  });

  it('the email is a verified email, never a verified person', async () => {
    const result = present(await factsFor(A));
    expect(result.facts.find((f) => f.key === 'account.email')).toMatchObject({
      value: 'nadia@atelier.example',
      provenance: 'VERIFIED_EMAIL',
      source: { kind: 'account_session', version: null },
    });
    expect(result.facts.find((f) => f.key === 'account.name')).toMatchObject({
      value: 'Nadia Rahman',
      provenance: 'ACCOUNT_SESSION',
    });
    expect(result.absent).toContainEqual({
      key: 'person.identity',
      reason: 'not_verified',
      workspaceId: A,
    });
  });

  it('an account without a name says so instead of inventing one', async () => {
    provider = {
      user: { id: 'subject-1', name: '  ', email: 'nadia@atelier.example', emailVerified: true },
    };
    const result = present(await factsFor(A));
    expect(result.facts.map((f) => f.key)).not.toContain('account.name');
    expect(result.absent).toContainEqual({
      key: 'account.name',
      reason: 'not_provided',
      workspaceId: A,
    });
  });

  it('the work families are derived, from this workspace only, without the unclassified bucket', async () => {
    workItems.items = workItems.items.filter((item) => item.family !== 'UNCLASSIFIED');
    const a = present(await factsFor(A));
    const fact = a.facts.find((f) => f.key === 'work.families');
    expect(fact).toMatchObject({
      value: ['SELL'],
      provenance: 'DERIVED',
      source: { kind: 'work_items', id: A, version: null },
    });
    expect(fact).not.toHaveProperty('complete');
    const b = present(await factsFor(B));
    expect(b.facts.find((f) => f.key === 'work.families')?.value).toEqual(['ORGANISE', 'SOURCE']);
  });

  it('an unclassified own item (e.g. an unreadable request detail) marks the families incomplete', async () => {
    const a = present(await factsFor(A));
    expect(a.facts.find((f) => f.key === 'work.families')).toMatchObject({
      value: ['SELL'],
      complete: false,
    });
    // Another workspace's unclassified item says nothing about this one.
    workItems.items = [
      { workspaceId: A, family: 'SELL', title: 't', status: 'OPEN', id: 'a1' },
      { workspaceId: B, family: 'UNCLASSIFIED', title: 't', status: 'OPEN', id: 'b9' },
    ];
    expect(
      present(await factsFor(A)).facts.find((f) => f.key === 'work.families'),
    ).not.toHaveProperty('complete');
  });

  it('only unclassified own items: the families are unreadable, never absent as not_provided', async () => {
    workItems.items = [
      { workspaceId: A, family: 'UNCLASSIFIED', title: 't', status: 'OPEN', id: 'a2' },
    ];
    const result = present(await factsFor(A));
    expect(result.facts.map((f) => f.key)).not.toContain('work.families');
    expect(result.absent).toContainEqual({
      key: 'work.families',
      reason: 'unreadable',
      workspaceId: A,
    });
  });

  it('a partial or unreadable work list is never presented as complete', async () => {
    workItems.partial = true;
    workItems.items = workItems.items.filter((item) => item.family !== 'UNCLASSIFIED');
    expect(present(await factsFor(A)).facts.find((f) => f.key === 'work.families')).toMatchObject({
      complete: false,
    });
    workItems.unreadable = ['drafts'];
    const result = present(await factsFor(A));
    expect(result.facts.map((f) => f.key)).not.toContain('work.families');
    expect(result.absent).toContainEqual({
      key: 'work.families',
      reason: 'unreadable',
      workspaceId: A,
    });
  });

  it('every present fact carries a known provenance and an ISO time', async () => {
    const result = present(await factsFor(A));
    for (const fact of result.facts) {
      expect([
        'SELF_REPORTED',
        'VERIFIED_EMAIL',
        'ACCOUNT_SESSION',
        'MEMBERSHIP',
        'DERIVED',
      ]).toContain(fact.provenance);
      expect(new Date(fact.asOf).toISOString()).toBe(fact.asOf);
    }
  });
});

describe('missing values', () => {
  it('no profile yet: every profile key is absent with not_provided', async () => {
    profiles[A] = null;
    const result = present(await factsFor(A));
    expect(result.facts.filter((f) => f.key.startsWith('organisation.'))).toEqual([]);
    for (const key of [
      'organisation.legalName',
      'organisation.countryCode',
      'organisation.website',
      'organisation.commercialRoles',
      'organisation.sectors',
      'organisation.sizeBand',
      'organisation.summary',
    ])
      expect(result.absent).toContainEqual({ key, reason: 'not_provided', workspaceId: A });
  });

  it('an empty website or sector list is absent, not an empty value', async () => {
    profiles[A] = { ...profileA, website: null, sectors: [] };
    const result = present(await factsFor(A));
    expect(result.absent).toContainEqual(
      expect.objectContaining({
        key: 'organisation.website',
        reason: 'not_provided',
        workspaceId: A,
      }),
    );
    expect(result.absent).toContainEqual(
      expect.objectContaining({
        key: 'organisation.sectors',
        reason: 'not_provided',
        workspaceId: A,
      }),
    );
  });

  it('profiles switched off: absent with module_off and no profile read', async () => {
    on.profiles = false;
    const result = present(await factsFor(A));
    expect(result.absent).toContainEqual({
      key: 'organisation.legalName',
      reason: 'module_off',
      workspaceId: A,
    });
    expect(calls).not.toContain('customerOrganisationProfiles.view');
  });

  it('membership revoked between the list and the profile read (SQLSTATE 42501) fails closed', async () => {
    for (const thrown of [
      Object.assign(new Error('Workspace unavailable'), { code: '42501' }),
      Object.assign(new Error('Profile access expired'), { code: '42501' }),
      Object.assign(new Error('Not found'), { status: 404 }),
      Object.assign(new Error('Forbidden'), { status: 403 }),
    ]) {
      services = {
        ...healthy(),
        customerOrganisationProfiles: guarded('customerOrganisationProfiles', {
          view: async () => {
            throw thrown;
          },
        }),
      };
      const result = await factsFor(A);
      expect(result).toEqual({
        ok: false,
        code: 'not_a_member',
        message: expect.any(String),
        workspaceId: A,
      });
    }
  });

  it('a failing profile read is unreadable, never not_provided', async () => {
    services = {
      ...healthy(),
      customerOrganisationProfiles: guarded('customerOrganisationProfiles', {
        view: async () => {
          throw new Error('database unavailable');
        },
      }),
    };
    const result = present(await factsFor(A));
    expect(result.absent).toContainEqual({
      key: 'organisation.legalName',
      reason: 'unreadable',
      workspaceId: A,
    });
  });

  it('workspaces switched off or foundations missing: a typed refusal', async () => {
    on.workspaces = false;
    expect(await factsFor(A)).toMatchObject({ ok: false, code: 'unavailable' });
    on.workspaces = true;
    services = null;
    expect(await factsFor(A)).toMatchObject({ ok: false, code: 'unavailable' });
  });
});

describe('read only, no cache, no intelligence', () => {
  const dir = resolve(__dirname, '../../apps/web/lib/commercial-identity');
  const source = ['facts.ts', 'types.ts']
    .map((file) => readFileSync(resolve(dir, file), 'utf8'))
    .join('\n');

  it('only the allowlisted read methods are ever called', async () => {
    present(await factsFor(A));
    present(await factsFor(B));
    const { listRepresentableWorkspaces } = await mod();
    await listRepresentableWorkspaces(await actor());
    expect(new Set(calls)).toEqual(
      new Set(['customerWorkspaces.list', 'customerOrganisationProfiles.view', 'workItems.load']),
    );
  });

  it('the source carries no SQL write, no command call and no intelligence import', () => {
    expect(source).not.toMatch(/\b(INSERT|UPDATE|DELETE|UPSERT|TRUNCATE)\b/);
    expect(source).not.toMatch(/\.(command|history|accept|revoke|invite)\(/);
    expect(source).not.toMatch(/packages\/intelligence|@corridra\/intelligence/);
    expect(source).not.toMatch(/app\/account/);
    expect(source).toMatch(/^import 'server-only';/m);
  });

  it('keeps no module-level cache', () => {
    expect(source).not.toMatch(/\bnew (Map|WeakMap|Set|WeakSet)\b/);
    expect(source).not.toMatch(/from 'react'/);
    expect(source).not.toMatch(/^(let|var) /m);
  });

  it('works with CORRIDRA_AI_ENABLED off', async () => {
    const before = process.env.CORRIDRA_AI_ENABLED;
    process.env.CORRIDRA_AI_ENABLED = 'false';
    try {
      present(await factsFor(A));
    } finally {
      if (before === undefined) delete process.env.CORRIDRA_AI_ENABLED;
      else process.env.CORRIDRA_AI_ENABLED = before;
    }
  });
});
