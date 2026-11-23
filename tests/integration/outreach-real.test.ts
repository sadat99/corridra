import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { realStaffFixture, future } from './real-staff-fixture';
import { command } from './access-fixture';
import { AccessService } from '../../packages/auth/src/access';
import { CommunicationService, hash } from '../../packages/communications/src/index';
import { OutreachChannel } from '../../packages/communications/src/adapters';
import { unsubscribeToken } from '../../packages/communications/src/real-outreach';
import { OutboxDispatcher } from '../../packages/workflows/src/index';
import { migrateOutreachReal } from '../../packages/db/src/outreach-real-migrate';
import { DeliveryExperienceService } from '../../packages/delivery/src/experience';

const { session, start, services } = vi.hoisted(() => ({
  session: vi.fn(),
  start: vi.fn(async (id: string) => `run-${id}`),
  services: { communications: undefined as unknown },
}));
vi.mock('server-only', () => ({}));
vi.mock('../../apps/web/lib/communication-orchestrator', () => ({
  communicationOrchestrator: { start },
}));
vi.mock('../../apps/web/lib/notify', () => ({ notify: vi.fn() }));
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    provider: { getSession: session },
    config: { APP_ORIGIN: 'https://app.corridra.test' },
    access: { config: async () => [] },
    communications: services.communications,
  }),
}));

// ADR-090. The real email lane against the database: consent, approval, suppression, bounces, limits, isolation and the
// reply page for a real recipient. The network is a counted stub in every test; the default mode is test mode.
const secret = 'outreach-real-integration-secret';
let s: Awaited<ReturnType<typeof realStaffFixture>>;
let comms: CommunicationService;
let policyId: string, templateId: string, missionId: string;
let env: Record<string, string | undefined>;
let fetched: string[];
const baseEnv = () => ({
  CORRIDRA_REAL_OUTREACH: 'true',
  REAL_OUTREACH_MAIL_KEY: 'k'.repeat(24),
  REAL_OUTREACH_MAIL_FROM: 'introductions@mail.business.test',
  REAL_OUTREACH_MAIL_REPLY_TO: 'team@mail.business.test',
  REAL_OUTREACH_WEBHOOK_SECRET: 'whsec_' + Buffer.from('s'.repeat(24)).toString('base64'),
  APP_ORIGIN: 'https://app.business.test',
});
const presentation = {
  company: 'Machinery participant',
  country: 'BD',
  capability: 'Planned factory expansion',
  fit: 'Declared exports fit the requested machinery',
  evidence: 'The request is self-declared',
  uncertainty: 'No interest is verified',
  conversationPurpose: 'Discuss whether the requirement fits',
  availableDates: 'Dates subject to agreement',
};
const consent = {
  basis: 'LEGITIMATE_INTEREST',
  note: 'Published sales address on the company site',
};
const owner = () => s.f.owner;
const dispatcher = () =>
  new OutboxDispatcher(
    s.f.runtime,
    new OutreachChannel(s.f.runtime, secret, () => env as NodeJS.ProcessEnv),
  );
async function prospect(email: string) {
  const target = await s.target(missionId, 'Supplier ' + randomUUID().slice(0, 8));
  const relationshipId = (
    await owner().query('SELECT relationship_id FROM app.target_account WHERE id=$1', [
      target.targetId,
    ])
  ).rows[0].relationship_id as string;
  const contact = await s.research.command(s.ctx, {
    action: 'contact',
    commandId: randomUUID(),
    relationshipId,
    sourceId: target.sourceId,
    name: 'Named contact',
    jobTitle: 'Sales manager',
    email,
    validUntil: future(6),
  });
  return { targetId: target.targetId, contactId: contact.id as string };
}
async function introduce(email: string, withConsent: object | null = consent) {
  const p = await prospect(email);
  const input = command('introduce', {
    ...p,
    policyId,
    templateId,
    introduction: presentation,
    expiresAt: future(),
    ...(withConsent ? { consent: withConsent } : {}),
  });
  const result = (await comms.command(s.ctx, input)) as { id: string; buyerPath: string };
  return { ...p, id: result.id, token: result.buyerPath.split('#')[1] };
}
const send = (id: string) => dispatcher().attempt(id, comms.dispatchCapability(id));
const receipt = async (id: string) =>
  (
    await owner().query('SELECT provider,reference FROM app.communication_receipt WHERE id=$1', [
      id,
    ])
  ).rows[0];
const status = async (id: string) =>
  (
    await owner().query('SELECT status,last_error FROM app.communication_dispatch WHERE id=$1', [
      id,
    ])
  ).rows[0];
const approached = async (targetId: string) =>
  (
    await owner().query(
      'SELECT approached FROM app.experience_outreach_rows_for($1,ARRAY[$2]::uuid[])',
      [s.intakeTenantId, targetId],
    )
  ).rows[0].approached as boolean;
beforeAll(async () => {
  s = await realStaffFixture(
    'https://ep-real-outreach-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth',
    secret,
  );
  await migrateOutreachReal(owner());
  const a = new AccessService(s.f.runtime);
  await a.appendConfig(s.ctx, { key: 'communications.introductions', enabled: true });
  await a.appendConfig(s.ctx, { key: 'communications.dispatch', enabled: true });
  comms = new CommunicationService(s.f.runtime, secret);
  services.communications = comms;
  policyId = (
    await comms.command(
      s.ctx,
      command('policy', {
        jurisdiction: 'OTHER',
        channel: 'EMAIL',
        contactPurpose: 'institutional_introduction',
        basis: 'Reviewed business introduction to a published company address',
        validUntil: future(5),
        enabled: true,
      }),
    )
  ).id;
  templateId = (
    await comms.command(
      s.ctx,
      command('template', {
        name: 'Reviewed supplier introduction',
        contactPurpose: 'institutional_introduction',
        body: 'Would a short conversation about this requirement be useful?',
      }),
    )
  ).id;
  missionId = await s.mission();
}, 240000);
afterAll(async () => {
  vi.unstubAllEnvs();
  await s?.f.close();
});
beforeEach(() => {
  env = baseEnv();
  fetched = [];
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(String(url));
    return new Response('{}', { status: 200 });
  });
});
afterEach(() => vi.unstubAllGlobals());

test('sample and real never mix: each workspace kind takes only its own channel', async () => {
  await expect(
    comms.command(
      s.ctx,
      command('policy', {
        jurisdiction: 'OTHER',
        channel: 'SYNTHETIC',
        contactPurpose: 'referral',
        basis: 'A sample channel in a real workspace must be refused',
        validUntil: future(5),
        enabled: true,
      }),
    ),
  ).rejects.toThrow();
  await expect(
    comms.command(
      s.f.users.owner.ctx,
      command('policy', {
        jurisdiction: 'ES',
        channel: 'EMAIL',
        contactPurpose: 'referral',
        basis: 'Real email in a sample workspace must be refused',
        validUntil: future(5),
        enabled: true,
      }),
    ),
  ).rejects.toThrow();
});

test('a real introduction needs recorded consent, and consent is kept with the message', async () => {
  await expect(introduce('no-consent@supplier-a.business.test', null)).rejects.toThrow(
    'Record why this person may be contacted before creating a real introduction.',
  );
  expect(
    (
      await owner().query(
        "SELECT count(*)::int n FROM app.communication_dispatch d JOIN app.private_contact_data c ON c.tenant_id=d.tenant_id WHERE c.email='no-consent@supplier-a.business.test'",
      )
    ).rows[0].n,
  ).toBe(0);
  const m = await introduce('consent@supplier-a.business.test');
  const row = (
    await owner().query(
      'SELECT basis,note,created_by,unsubscribe_hash FROM app.outreach_consent WHERE message_id=$1',
      [m.id],
    )
  ).rows[0];
  expect(row).toMatchObject({ ...consent, created_by: s.f.users.owner.id });
  expect(row.unsubscribe_hash).toBe(hash(unsubscribeToken(secret, m.id)));
  await expect(
    owner().query("UPDATE app.outreach_consent SET note='changed' WHERE message_id=$1", [m.id]),
  ).rejects.toThrow();
});

test('nothing is sent without the staff dispatch, and test mode sends nothing to a real address', async () => {
  const m = await introduce('approval@supplier-b.business.test');
  expect(await receipt(m.id)).toBeUndefined();
  expect(await status(m.id)).toMatchObject({ status: 'PENDING' });
  expect(await send(m.id)).toBe('DELIVERED');
  expect(fetched).toEqual([]);
  expect(await receipt(m.id)).toEqual({ provider: 'email_test', reference: `sink:${m.id}` });
  expect(await send(m.id)).toBe('DELIVERED');
  expect(fetched).toEqual([]);
  // A test-mode receipt is never counted as an approach on a customer report.
  expect(await approached(m.targetId)).toBe(false);
});

test('with the switch off or a setting missing a queued message is never delivered', async () => {
  const m = await introduce('closed@supplier-c.business.test');
  env = { ...baseEnv(), CORRIDRA_REAL_OUTREACH: undefined };
  expect(await send(m.id)).toBe('PENDING');
  env = { ...baseEnv(), CORRIDRA_REAL_OUTREACH_MODE: 'live', REAL_OUTREACH_MAIL_KEY: undefined };
  await owner().query('UPDATE app.communication_dispatch SET available_at=now() WHERE id=$1', [
    m.id,
  ]);
  expect(await send(m.id)).toBe('PENDING');
  expect(fetched).toEqual([]);
  expect(await receipt(m.id)).toBeUndefined();
  // The third failed attempt stops the message. It is kept, and the existing staff retry queues it again.
  await owner().query('UPDATE app.communication_dispatch SET available_at=now() WHERE id=$1', [
    m.id,
  ]);
  expect(await send(m.id)).toBe('DEAD');
  expect(fetched).toEqual([]);
  await comms.command(
    s.ctx,
    command('retry', { messageId: m.id, reason: 'Settings are complete now' }),
  );
  expect(await status(m.id)).toMatchObject({ status: 'PENDING' });
  env = baseEnv();
  expect(await send(m.id)).toBe('DELIVERED');
});

test('each workspace kind resolves only its own service executor', async () => {
  const executor = async (tenant: string) =>
    (await owner().query('SELECT app.outreach_executor($1,true) e', [tenant])).rows[0].e;
  expect(await executor(s.f.tenantA)).toBe(
    (await owner().query('SELECT service_id FROM app.intake_destination')).rows[0].service_id,
  );
  expect(await executor(s.intakeTenantId)).toBe(
    (await owner().query('SELECT executor_id FROM customer_private.real_use_configuration')).rows[0]
      .executor_id,
  );
  // A sample workspace with no sample executor resolves nobody: it never falls through to the real one.
  expect(await executor(s.f.tenantB)).toBeNull();
  expect(await executor(randomUUID())).toBeNull();
  const db = await s.f.runtime.connect();
  try {
    await expect(
      db.query('SELECT app.outreach_executor($1,true)', [s.intakeTenantId]),
    ).rejects.toMatchObject({ code: '42501' });
  } finally {
    db.release();
  }
});

test('live mode sends once and the reply page opens for the real recipient as real, never as a sample', async () => {
  const m = await introduce('live@supplier-d.business.test');
  env = { ...baseEnv(), CORRIDRA_REAL_OUTREACH_MODE: 'live' };
  expect(await send(m.id)).toBe('DELIVERED');
  expect(fetched).toEqual(['https://api.resend.com/emails']);
  expect(await receipt(m.id)).toEqual({ provider: 'email', reference: `resend:${m.id}` });
  expect(await approached(m.targetId)).toBe(true);
  const view = await comms.buyer({ action: 'read', token: m.token });
  expect(view).toMatchObject({ introduction: presentation, decision: null, synthetic: false });
  expect(JSON.stringify(view)).not.toContain('supplier-d.business.test');
  expect(
    await comms.buyer({
      action: 'respond',
      token: m.token,
      responseId: randomUUID(),
      decision: 'INTERESTED',
      optOut: false,
    }),
  ).toEqual({ decision: 'INTERESTED', recorded: true });
  expect(await comms.buyer({ action: 'read', token: m.token })).toMatchObject({
    decision: 'INTERESTED',
    synthetic: false,
  });
  // The opt-out on the reply page is recorded by the real executor and suppresses the address.
  const second = await introduce('page-optout@supplier-d.business.test');
  expect(await comms.buyer({ action: 'optout', token: second.token })).toEqual({ optedOut: true });
  expect(await send(second.id)).toBe('SUPPRESSED');
  expect(
    (
      await owner().query(
        'SELECT p.kind FROM app.communication_optout o JOIN identity.principal p ON p.id=o.created_by WHERE o.contact_id=$1',
        [second.contactId],
      )
    ).rows,
  ).toEqual([{ kind: 'service' }]);
});

test('the workspace limit and the global limit each stop the next send', async () => {
  const day = "(now() AT TIME ZONE 'UTC')::date";
  const used = async () =>
    (
      await owner().query(
        `SELECT coalesce(sum(sent),0)::int n FROM app.outreach_send_count WHERE day=${day} AND tenant_id=$1`,
        [s.intakeTenantId],
      )
    ).rows[0].n as number;
  const first = await introduce('limit-one@supplier-f.business.test');
  const second = await introduce('limit-two@supplier-f.business.test');
  env = { ...baseEnv(), CORRIDRA_REAL_OUTREACH_DAILY_WORKSPACE_LIMIT: String((await used()) + 1) };
  expect(await send(first.id)).toBe('DELIVERED');
  expect(await send(second.id)).toBe('PENDING');
  expect(await receipt(second.id)).toBeUndefined();
  expect(await status(second.id)).toEqual({ status: 'PENDING', last_error: 'TRANSIENT' });
  env = { ...baseEnv(), CORRIDRA_REAL_OUTREACH_DAILY_GLOBAL_LIMIT: String(await used()) };
  await owner().query('UPDATE app.communication_dispatch SET available_at=now() WHERE id=$1', [
    second.id,
  ]);
  expect(await send(second.id)).toBe('PENDING');
  expect(await receipt(second.id)).toBeUndefined();
  expect(await status(second.id)).toEqual({ status: 'PENDING', last_error: 'TRANSIENT' });
  expect(fetched).toEqual([]);
});

test('an opt-out link always works, is repeatable, and stops every later send to that address', async () => {
  const email = 'optout@supplier-g.business.test';
  const queued = await introduce(email);
  const other = await introduce(email);
  expect(await comms.unsubscribe('f'.repeat(64))).toBe(false);
  expect(await comms.unsubscribe(queued.token)).toBe(false);
  env = { ...baseEnv(), CORRIDRA_REAL_OUTREACH: undefined };
  expect(await comms.unsubscribe(unsubscribeToken(secret, queued.id))).toBe(true);
  expect(await comms.unsubscribe(unsubscribeToken(secret, queued.id))).toBe(true);
  expect(
    (
      await owner().query(
        "SELECT reason FROM app.outreach_suppression WHERE recipient_key=encode(sha256(convert_to($1,'UTF8')),'hex')",
        [email],
      )
    ).rows,
  ).toEqual([{ reason: 'OPT_OUT' }]);
  env = { ...baseEnv(), CORRIDRA_REAL_OUTREACH_MODE: 'live' };
  expect(await send(queued.id)).toBe('SUPPRESSED');
  expect(await send(other.id)).toBe('SUPPRESSED');
  await expect(introduce(email.toUpperCase())).rejects.toThrow();
  expect(fetched).toEqual([]);
});

test('a hard bounce or a complaint suppresses the address once; a soft bounce and a replay do not', async () => {
  const soft = await introduce('soft@supplier-h.business.test');
  const hard = await introduce('hard@supplier-h.business.test');
  const key = async (email: string) =>
    (
      await owner().query(
        "SELECT count(*)::int n FROM app.outreach_suppression WHERE recipient_key=encode(sha256(convert_to($1,'UTF8')),'hex')",
        [email],
      )
    ).rows[0].n;
  expect(
    await comms.providerEvent('evt-soft', { messageId: soft.id, kind: 'BOUNCED', hard: false }),
  ).toBe(true);
  expect(await key('soft@supplier-h.business.test')).toBe(0);
  expect(
    await comms.providerEvent('evt-hard', { messageId: hard.id, kind: 'BOUNCED', hard: true }),
  ).toBe(true);
  expect(
    await comms.providerEvent('evt-hard', { messageId: hard.id, kind: 'BOUNCED', hard: true }),
  ).toBe(false);
  expect(
    await comms.providerEvent('evt-unknown', {
      messageId: randomUUID(),
      kind: 'COMPLAINED',
      hard: true,
    }),
  ).toBe(false);
  expect(await key('hard@supplier-h.business.test')).toBe(1);
  expect(
    (
      await owner().query(
        'SELECT count(*)::int n FROM app.outreach_provider_event WHERE message_id=$1',
        [hard.id],
      )
    ).rows[0].n,
  ).toBe(1);
  env = { ...baseEnv(), CORRIDRA_REAL_OUTREACH_MODE: 'live' };
  expect(await send(hard.id)).toBe('SUPPRESSED');
  expect(await send(soft.id)).toBe('DELIVERED');
  expect(fetched).toHaveLength(1);
});

test('another workspace and the runtime role itself cannot read consent, suppression, counts or a payload', async () => {
  const m = await introduce('private@supplier-i.business.test');
  const db = await s.f.runtime.connect();
  try {
    for (const table of ['outreach_suppression', 'outreach_send_count'])
      await expect(db.query(`SELECT * FROM app.${table}`)).rejects.toMatchObject({ code: '42501' });
    expect((await db.query('SELECT * FROM app.outreach_consent')).rows).toEqual([]);
    expect((await db.query('SELECT * FROM app.outreach_provider_event')).rows).toEqual([]);
    await expect(
      db.query('SELECT app.outreach_real_payload($1,$2,$3)', [
        m.id,
        hash(comms.dispatchCapability(m.id)),
        randomUUID(),
      ]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      db.query("SELECT app.deliver_real_email($1,$2,$3,'email','resend:x')", [
        m.id,
        hash(comms.dispatchCapability(m.id)),
        randomUUID(),
      ]),
    ).rejects.toMatchObject({ code: '42501' });
  } finally {
    db.release();
  }
  expect((await comms.workspace(s.f.users.other.ctx)).messages).toEqual([]);
});

test('a test-mode message that left for nowhere is labelled for staff as not sent', async () => {
  const m = await introduce('label@supplier-j.business.test');
  expect(await send(m.id)).toBe('DELIVERED');
  const row = (await comms.workspace(s.ctx)).messages.find((x) => x.id === m.id);
  expect(row).toMatchObject({ receipt_provider: 'email_test', delivery_note: 'Test, not sent' });
});

test('a suppression that lands while the provider is accepting the message does not lose the receipt', async () => {
  const email = 'race@supplier-k.business.test';
  const m = await introduce(email);
  env = { ...baseEnv(), CORRIDRA_REAL_OUTREACH_MODE: 'live' };
  vi.stubGlobal('fetch', async (url: string) => {
    fetched.push(String(url));
    expect(await comms.unsubscribe(unsubscribeToken(secret, m.id))).toBe(true);
    return new Response('{}', { status: 200 });
  });
  expect(await send(m.id)).toBe('DELIVERED');
  expect(fetched).toHaveLength(1);
  expect(await receipt(m.id)).toEqual({ provider: 'email', reference: `resend:${m.id}` });
  // The address is suppressed from then on.
  await expect(introduce(email)).rejects.toThrow();
});

test('one staff dispatch sends one named real message; a dispatch without a name never sends a real one', async () => {
  const { POST } = await import('../../apps/web/app/api/workspace/[action]/route');
  const dispatch = (body: unknown) =>
    POST(
      new Request(`https://app.corridra.test/api/workspace/dispatch?tenant=${s.intakeTenantId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://app.corridra.test' },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ action: 'dispatch' }) },
    );
  session.mockResolvedValue({ token: s.f.users.owner.token });
  const first = await introduce('one@supplier-l.business.test');
  const second = await introduce('two@supplier-l.business.test');
  start.mockClear();
  const batch = await dispatch({});
  expect([batch.status, await batch.json()]).toEqual([201, { started: [] }]);
  expect(start).not.toHaveBeenCalled();
  const one = await dispatch({ messageId: first.id });
  expect([one.status, await one.json()]).toEqual([201, { started: [first.id] }]);
  expect(start.mock.calls).toEqual([[first.id]]);
  expect(
    (
      await owner().query(
        'SELECT id,workflow_run_id FROM app.communication_dispatch WHERE id=ANY($1::uuid[]) ORDER BY workflow_run_id NULLS LAST',
        [[first.id, second.id]],
      )
    ).rows,
  ).toEqual([
    { id: first.id, workflow_run_id: `run-${first.id}` },
    { id: second.id, workflow_run_id: null },
  ]);
  // A message that is unknown, or of a workspace this staff member is not in, is refused and starts nothing.
  expect((await dispatch({ messageId: randomUUID() })).status).toBe(409);
  session.mockResolvedValue({ token: s.f.users.other.token });
  expect((await dispatch({ messageId: second.id })).status).toBeGreaterThanOrEqual(400);
  expect(start.mock.calls).toEqual([[first.id]]);
});

test('the opt-out limit never spends the shared hourly total', async () => {
  let closed = false;
  for (let n = 0; n < 61 && !closed; n++)
    await comms.budget(`caller-${n}`, `token-${n}`).catch(() => {
      closed = true;
    });
  expect(closed).toBe(true);
  await expect(comms.budget('fresh-caller', 'fresh-token')).rejects.toThrow('Too many requests');
  await expect(comms.optOutBudget('fresh-caller', 'fresh-token')).resolves.toBeUndefined();
  // Its own limits still hold: one token is tried at most 6 times an hour.
  let stopped = false;
  for (let n = 0; n < 7 && !stopped; n++)
    await comms.optOutBudget(`other-${n}`, 'same-token').catch(() => {
      stopped = true;
    });
  expect(stopped).toBe(true);
});

test('a real recipient can send the full reply form', async () => {
  const m = await introduce('form@supplier-m.business.test');
  const experience = new DeliveryExperienceService(s.f.runtime);
  await experience.disclosure(s.ctx, {
    commandId: randomUUID(),
    linkId: m.id,
    role: 'SUPPLIER',
    sharedRequirements: 'Only the approved machinery requirement is shared.',
    uncertainty: 'Budget and technical fit are not verified.',
    rfqId: null,
    allowQuotation: false,
    allowMeetingInterest: true,
    approved: true,
    reason: 'Reviewed disclosure for the real reply form',
  });
  const view = (await comms.buyer({ action: 'read', token: m.token })) as Record<string, unknown>;
  expect(view).toMatchObject({ role: 'SUPPLIER', synthetic: false });
  const reply = {
    action: 'detail-response',
    token: m.token,
    responseId: randomUUID(),
    body: 'We can supply this machine. Please confirm the technical parameters.',
    meetingInterest: true,
    quotation: null,
    acknowledged: true,
  };
  expect(await comms.buyer(reply)).toMatchObject({
    recorded: true,
    sourceKind: 'SELF_DECLARATION',
  });
  expect(await comms.buyer(reply)).toMatchObject({ recorded: true });
});

// Last in the file: it changes the approver's own sign-in.
test('the approval is checked again at send time: an approver without two-step sign-in sends nothing', async () => {
  const m = await introduce('approver@supplier-e.business.test');
  const user = (
    await owner().query('SELECT identity_id FROM identity.principal WHERE id=$1', [
      s.f.users.owner.id,
    ])
  ).rows[0].identity_id;
  await owner().query('UPDATE identity."user" SET "twoFactorEnabled"=false WHERE id=$1', [user]);
  try {
    expect(await send(m.id)).toBe('SUPPRESSED');
  } finally {
    await owner().query('UPDATE identity."user" SET "twoFactorEnabled"=true WHERE id=$1', [user]);
  }
  expect(fetched).toEqual([]);
  expect(await receipt(m.id)).toBeUndefined();
});
