import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { hidden, World } from './organisation-link-support';
import { Staff, unavailable } from './source-rights-support';
import { sourceRightsHidden } from './source-rights-hide';

// ADR-079 slice B (ADR-082 S1), part two: the takedown (suppression) writer, claim redaction and the closed-claims lookup.
// RIGHTS_BASE_CHECK=1 keeps the new ladder file away from the migrator, which is how each test is shown to fail on main.
vi.hoisted(() => {
  (globalThis as { __linkHide?: boolean }).__linkHide = true;
});
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  const readdir = (async (path: unknown, ...rest: unknown[]) => {
    const names = (await (real.readdir as (...a: unknown[]) => Promise<unknown[]>)(
      path,
      ...rest,
    )) as unknown[];
    const base =
      (globalThis as { __linkHide?: boolean }).__linkHide &&
      String(path).includes('customer-real-use-migrations');
    return names.filter(
      (n) =>
        !sourceRightsHidden(String(path), String(n)) &&
        !(
          base &&
          /^(0013_organisation_link_provenance_and_search|0014_|0015_|0016_|0017_|0018_|0019_|0020_|0021_)/.test(
            String(n),
          )
        ),
    );
  }) as typeof real.readdir;
  return { ...real, readdir, default: { ...real, readdir } };
});

let w: World;
let s: Staff;
beforeAll(async () => {
  w = await World.build('corridra_integration');
  await w.install();
  s = new Staff(w);
}, 300000);
afterAll(async () => {
  await w?.close();
});

type Who = 'owner' | 'operator' | 'reviewer' | 'viewer' | 'other';
const suppress = (
  who: Who,
  side: 'real' | 'synthetic',
  input: Record<string, unknown>,
  command = randomUUID(),
) => s.fn(s.ctx(who, side), 'app.customer_organisation_suppress', command, JSON.stringify(input));
const input = (
  organisationId: string,
  state: 'hidden' | 'shown',
  over: Record<string, unknown> = {},
) => ({
  organisationId,
  state,
  reason:
    state === 'hidden' ? 'Takedown requested by the company' : 'The company withdrew its request',
  reference: 'TICKET-3003',
  ...over,
});
const failure = async (work: Promise<unknown>) => {
  const e = (await work.then(
    () => ({ code: 'none', message: 'succeeded' }),
    (error: { code: string; message: string }) => error,
  )) as { code: string; message: string };
  return `${e.code}|${e.message}`;
};
const withMfa = async (who: Who, age: string, work: () => Promise<unknown>) => {
  const session = w.f.users[who]!.sessionId;
  await w.f.owner.query(
    'UPDATE identity.assurance SET verified_at=now()-$2::interval WHERE session_id=$1',
    [session, age],
  );
  try {
    return await work();
  } finally {
    await w.freshStaff();
  }
};

test('hide then show: reason and reference are mandatory, a retry returns the original answer and a changed retry conflicts', async () => {
  const made = await s.ingest('real', s.identity('real', 'Takedown Basic GmbH'), 'other');
  for (const bad of [
    { reason: undefined },
    { reference: undefined },
    { reason: 'ab' },
    { reference: 'ab' },
    { reference: 'x'.repeat(121) },
    { reason: ' padded ' },
    { reference: 'Line\nbreak' },
    { state: 'banana' },
    { extra: true },
  ])
    await expect(
      suppress('reviewer', 'real', { ...input(made.id, 'hidden'), ...bad }),
    ).rejects.toMatchObject({
      code: '23514',
      message: 'Invalid organisation takedown request',
    });
  expect(await s.suppressionRows(made.id)).toHaveLength(0);
  const command = randomUUID();
  const body = input(made.id, 'hidden');
  const first = await suppress('reviewer', 'real', body, command);
  expect(first).toEqual({
    organisationId: made.id,
    commandId: command,
    state: 'hidden',
    version: 1,
  });
  expect(await suppress('reviewer', 'real', body, command)).toEqual(first);
  await expect(
    suppress('reviewer', 'real', { ...body, reason: 'Another reason' }, command),
  ).rejects.toMatchObject({
    code: '23514',
    message: 'Command conflicts with original request',
  });
  await expect(suppress('reviewer', 'real', body)).rejects.toMatchObject({
    code: '23514',
    message: 'That organisation is already hidden',
  });
  await expect(
    suppress('owner', 'real', input(made.id, 'shown', { reason: 'Shown without a takedown' })),
  ).resolves.toMatchObject({ state: 'shown', version: 2 });
  await expect(suppress('owner', 'real', input(made.id, 'shown'))).rejects.toMatchObject({
    message: 'That organisation is already shown',
  });
  const rows = await s.suppressionRows(made.id);
  expect(rows.map((r) => [r.version, r.state])).toEqual([
    [1, 'hidden'],
    [2, 'shown'],
  ]);
  expect(rows[0]).toMatchObject({
    staff_actor: w.f.users.reviewer!.id,
    command_id: command,
    request: body,
  });
  // A never-hidden organisation cannot be "shown".
  const fresh = await s.ingest('real', s.identity('real', 'Takedown Never GmbH'), 'other');
  await expect(suppress('owner', 'real', input(fresh.id, 'shown'))).rejects.toMatchObject({
    message: 'That organisation is already shown',
  });
});

test('the suppression table cannot be rewritten and the event of a takedown carries ids, version and state only', async () => {
  const made = await s.ingest('real', s.identity('real', 'Takedown Event GmbH'), 'other');
  await suppress(
    'reviewer',
    'real',
    input(made.id, 'hidden', {
      reason: 'SECRET-REASON-' + made.id,
      reference: 'SECRET-REF-' + made.id,
    }),
  );
  for (const sql of [
    'UPDATE customer_private.organisation_suppression SET reason=reason',
    'DELETE FROM customer_private.organisation_suppression',
  ])
    await expect(
      w.f.owner.query(sql + ' WHERE organisation_id=$1', [made.id]),
      sql,
    ).rejects.toMatchObject({ code: '23514' });
  const [event] = (await s.events('customer.organisation_catalogue.hidden')).filter(
    (e) => e.aggregate_id === made.id,
  );
  expect(event).toMatchObject({
    tenant_id: w.intake,
    aggregate_version: 1,
    actor_id: w.f.users.reviewer!.id,
  });
  expect(JSON.stringify(event.payload)).not.toContain('SECRET');
  expect(Object.keys(event.payload).sort()).toEqual([
    'initiator_id',
    'initiator_kind',
    'organisationId',
    'state',
    'synthetic',
    'version',
  ]);
  const chain = await w.f.owner.query(
    `SELECT (SELECT count(*) FROM app.audit_event WHERE domain_event_id=$1)::int audit,(SELECT count(*) FROM app.outbox WHERE event_id=$1)::int outbox,
      (SELECT count(*) FROM app.outbox_delivery WHERE event_id=$1)::int delivery`,
    [event.id],
  );
  expect(chain.rows[0]).toEqual({ audit: 1, outbox: 1, delivery: 1 });
  await suppress('owner', 'real', input(made.id, 'shown'));
  const shownEvents = (await s.events('customer.organisation_catalogue.shown')).filter(
    (e) => e.aggregate_id === made.id,
  );
  expect(shownEvents).toHaveLength(1);
  expect(shownEvents[0]).toMatchObject({ aggregate_version: 2 });
});

test('a hidden organisation is gone from customer search, the exact lane, new filings and staff candidates, and the ledger refuses a new link', async () => {
  const domain = `takedown-${randomUUID().slice(0, 8)}.de`;
  const made = await s.ingest(
    'real',
    s.identity('real', 'Takedown Probe GmbH', { domain }),
    'other',
  );
  const person = await w.freshWriter('tp1', 'Takedown Probe GmbH', 'https://www.' + domain);
  const found = async () =>
    (
      await w
        .link(person.who, 'real')
        .search({ workspaceId: person.workspaceId, q: 'Takedown Probe' })
    ).organisations.map((o) => o.id);
  const exact = async () =>
    (
      await w.link(person.who, 'real').search({ workspaceId: person.workspaceId, q: 'zzzzzzzz' })
    ).organisations.map((o) => o.id);
  expect(await found()).toContain(made.id);
  expect(await exact()).toContain(made.id);
  const claim = (
    await w.link(person.who, 'real').command({
      action: 'file',
      commandId: randomUUID(),
      workspaceId: person.workspaceId,
      expectedProfileVersion: 1,
      kind: 'PROPOSED_NEW',
      organisationId: null,
      note: 'Please review our company information',
    })
  ).claim!.id!;
  const candidates = async () =>
    (await w.staff().review(w.rsCtx, claim)).candidates.organisations.map((o) => o.id);
  expect(await candidates()).toContain(made.id);
  await suppress('reviewer', 'real', input(made.id, 'hidden'));
  expect(await found()).not.toContain(made.id);
  expect(await exact()).not.toContain(made.id);
  expect(await candidates()).not.toContain(made.id);
  const other = await w.freshWriter('tp2', 'Nonesuch Handel GmbH');
  await expect(
    w.link(other.who, 'real').command({
      action: 'file',
      commandId: randomUUID(),
      workspaceId: other.workspaceId,
      expectedProfileVersion: 1,
      kind: 'EXISTING',
      organisationId: made.id,
      note: 'Please review our company information',
    }),
  ).rejects.toThrow(/cannot be requested/);
  await expect(
    w.f.owner.query(
      "INSERT INTO customer_private.organisation_link(tenant_id,version,state,claim_id,organisation_id,shared,staff_actor) VALUES($1,1,'linked',$2,$3,false,$4)",
      [person.workspaceId, claim, made.id, w.f.users.reviewer!.id],
    ),
  ).rejects.toMatchObject({ message: 'That organisation is not available for linking' });
  // Showing it again returns it everywhere, and the history of both rows is kept.
  await suppress('owner', 'real', input(made.id, 'shown'));
  expect(await found()).toContain(made.id);
  expect(await candidates()).toContain(made.id);
  expect(await s.suppressionRows(made.id)).toHaveLength(2);
});

test('who may hide and show: link staff hide, only owner or admin show, and operator, viewer, stale MFA and other tenants are denied', async () => {
  const made = await s.ingest('real', s.identity('real', 'Takedown Roles GmbH'), 'other');
  for (const who of ['operator', 'viewer', 'other'] as const)
    await expect(suppress(who, 'real', input(made.id, 'hidden')), who).rejects.toMatchObject({
      code: '42501',
    });
  await expect(suppress('other', 'synthetic', input(made.id, 'hidden'))).rejects.toMatchObject({
    code: '42501',
  });
  await withMfa('reviewer', '10 minutes', async () => {
    await expect(suppress('reviewer', 'real', input(made.id, 'hidden'))).rejects.toMatchObject({
      code: '42501',
      message: 'Reviewer access with a fresh authenticator check is required',
    });
  });
  expect(await s.suppressionRows(made.id)).toHaveLength(0);
  await suppress('reviewer', 'real', input(made.id, 'hidden'));
  await expect(suppress('reviewer', 'real', input(made.id, 'shown'))).rejects.toMatchObject({
    code: '42501',
    message: 'Owner or admin required to show an organisation again',
  });
  await withMfa('owner', '10 minutes', async () => {
    await expect(suppress('owner', 'real', input(made.id, 'shown'))).rejects.toMatchObject({
      code: '42501',
    });
  });
  expect((await s.suppressionRows(made.id)).map((r) => r.state)).toEqual(['hidden']);
  await expect(suppress('owner', 'real', input(made.id, 'shown'))).resolves.toMatchObject({
    state: 'shown',
  });
});

test('provenance cells: each side takes down its own organisations, and an organisation of the other side or an unknown one reads the same', async () => {
  const real = await s.ingest('real', s.identity('real', 'Takedown Cell Real GmbH'), 'other');
  const sample = await s.ingest(
    'synthetic',
    s.identity('synthetic', 'Synthetic Takedown Cell AG'),
    'other',
  );
  await expect(
    suppress('reviewer', 'synthetic', input(sample.id, 'hidden')),
  ).resolves.toMatchObject({ state: 'hidden' });
  const refusals = new Set<string>();
  for (const run of [
    () => suppress('reviewer', 'synthetic', input(real.id, 'hidden')),
    () => suppress('reviewer', 'real', input(sample.id, 'hidden')),
    () => suppress('reviewer', 'real', input(randomUUID(), 'hidden')),
  ])
    refusals.add(await failure(run()));
  expect([...refusals]).toEqual(['42501|' + unavailable]);
  expect(await s.suppressionRows(real.id)).toHaveLength(0);
  expect(await s.suppressionRows(sample.id)).toHaveLength(1);
  // A session without staff identity is refused before anything else.
  await expect(
    w.f.runtime.query('SELECT app.customer_organisation_suppress($1,$2)', [
      randomUUID(),
      JSON.stringify(input(real.id, 'hidden')),
    ]),
  ).rejects.toMatchObject({ code: '42501' });
});

test('two parallel takedown commands serialise: one wins, the other is refused, and versions stay distinct', async () => {
  const made = await s.ingest('real', s.identity('real', 'Takedown Race GmbH'), 'other');
  const results = await Promise.allSettled([
    suppress('reviewer', 'real', input(made.id, 'hidden')),
    suppress('owner', 'real', input(made.id, 'hidden', { reference: 'TICKET-4004' })),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
  expect(refused.reason).toMatchObject({ message: 'That organisation is already hidden' });
  expect((await s.suppressionRows(made.id)).map((r) => r.version)).toEqual([1]);
  // A hide and a show in parallel end in a state that the latest row names, with distinct versions.
  const mixed = await Promise.allSettled([
    suppress('owner', 'real', input(made.id, 'shown')),
    suppress('reviewer', 'real', input(made.id, 'hidden')),
  ]);
  expect(mixed.some((r) => r.status === 'fulfilled')).toBe(true);
  const versions = (await s.suppressionRows(made.id)).map((r) => r.version);
  expect(versions).toEqual([...new Set(versions)].sort((a, b) => a - b));
  // The same command twice in parallel writes one row.
  const other = await s.ingest('real', s.identity('real', 'Takedown Twin GmbH'), 'other');
  const command = randomUUID();
  const twins = await Promise.all([
    suppress('reviewer', 'real', input(other.id, 'hidden'), command),
    suppress('reviewer', 'real', input(other.id, 'hidden'), command),
  ]);
  expect(twins[0]).toEqual(twins[1]);
  expect(await s.suppressionRows(other.id)).toHaveLength(1);
});

// A claim of a fresh real workspace that staff rejected, so that it is closed.
async function closedClaim(label: string, note = 'Private note of ' + label) {
  const person = await w.freshWriter(label, 'Nonesuch Handel GmbH');
  const claim = (
    await w.link(person.who, 'real').command({
      action: 'file',
      commandId: randomUUID(),
      workspaceId: person.workspaceId,
      expectedProfileVersion: 1,
      kind: 'PROPOSED_NEW',
      organisationId: null,
      note,
    })
  ).claim!.id!;
  return { ...person, claim };
}
const reject = async (claim: string) => {
  const review = await w.staff().review(w.rsCtx, claim);
  await w.staff().decide(w.rsCtx, {
    commandId: randomUUID(),
    claimId: claim,
    expectedVersion: review.version,
    decision: 'reject',
    reason: 'Reason text staff wrote',
    internalNote: null,
    organisationId: null,
    shareConfirmed: false,
  });
};
const redactInput = (claim: string, over: Record<string, unknown> = {}) => ({
  claimId: claim,
  confirmClaimId: claim,
  reason: 'Erasure request from the company',
  reference: 'ERASE-5005',
  ...over,
});
const redact = (who: Who, body: Record<string, unknown>, command = randomUUID()) =>
  s.fn(s.ctx(who, 'real'), 'app.customer_organisation_link_redact', command, JSON.stringify(body));

test('redact: an open claim, a mismatched confirmation and a reviewer are refused; a closed claim is redacted and every reader masks it', async () => {
  const c = await closedClaim('rd1');
  await expect(redact('owner', redactInput(c.claim))).rejects.toMatchObject({
    code: '23514',
    message: 'Reject the claim before redacting it',
  });
  await reject(c.claim);
  await expect(
    redact('owner', redactInput(c.claim, { confirmClaimId: randomUUID() })),
  ).rejects.toMatchObject({
    code: '23514',
    message: 'The confirmation does not match the claim to redact',
  });
  for (const bad of [
    { reason: 'ab' },
    { reference: 'ab' },
    { reason: undefined },
    { extra: 1 },
    { claimId: 'x' },
  ])
    await expect(redact('owner', { ...redactInput(c.claim), ...bad })).rejects.toMatchObject({
      code: '23514',
      message: 'Invalid redaction request',
    });
  await expect(redact('reviewer', redactInput(c.claim))).rejects.toMatchObject({
    code: '42501',
    message: 'Owner or admin required to redact a claim',
  });
  await expect(redact('operator', redactInput(c.claim))).rejects.toMatchObject({ code: '42501' });
  await expect(redact('viewer', redactInput(c.claim))).rejects.toMatchObject({ code: '42501' });
  await expect(redact('other', redactInput(c.claim))).rejects.toMatchObject({ code: '42501' });
  await withMfa('owner', '10 minutes', async () => {
    await expect(redact('owner', redactInput(c.claim))).rejects.toMatchObject({ code: '42501' });
  });
  const count = async () =>
    (
      await w.f.owner.query(
        'SELECT count(*)::int n FROM customer_private.organisation_link_redaction WHERE claim_id=$1',
        [c.claim],
      )
    ).rows[0].n;
  expect(await count()).toBe(0);
  const command = randomUUID();
  const body = redactInput(c.claim);
  const done = await redact('owner', body, command);
  expect(done).toEqual({ claimId: c.claim, commandId: command, redacted: true });
  expect(await count()).toBe(1);
  // Retry returns the same answer; a changed body conflicts; another command on the same claim is refused.
  expect(await redact('owner', body, command)).toEqual(done);
  await expect(
    redact('owner', { ...body, reason: 'Another reason' }, command),
  ).rejects.toMatchObject({ message: 'Command conflicts with original request' });
  await expect(redact('owner', body)).rejects.toMatchObject({
    message: 'That claim is already redacted',
  });
  expect(await count()).toBe(1);
  // The existing readers now mask the text.
  const review = await w.staff().review(w.rsCtx, c.claim);
  expect(review).toMatchObject({ redacted: true, note: hidden });
  expect(review.profile.legalName).toBe(hidden);
  expect(JSON.stringify(review)).not.toContain('Private note');
  const view = await w.link(c.who, 'real').view({ workspaceId: c.workspaceId });
  expect(JSON.stringify(view)).not.toContain('Private note');
  // The row cannot be changed or removed.
  for (const sql of [
    'UPDATE customer_private.organisation_link_redaction SET reason=reason',
    'DELETE FROM customer_private.organisation_link_redaction',
  ])
    await expect(w.f.owner.query(sql + ' WHERE claim_id=$1', [c.claim]), sql).rejects.toMatchObject(
      { code: '23514' },
    );
});

test('redaction writes one event in the workspace of the claim with ids, version and state only', async () => {
  const c = await closedClaim('rd2');
  await reject(c.claim);
  await redact(
    'owner',
    redactInput(c.claim, {
      reason: 'SECRET-REASON-' + c.claim,
      reference: 'SECRET-REF-' + c.claim,
    }),
  );
  const events = (await s.events('customer.organisation_link.redacted')).filter(
    (e) => e.tenant_id === c.workspaceId,
  );
  expect(events).toHaveLength(1);
  expect(events[0].payload).toMatchObject({
    claimId: c.claim,
    state: 'rejected',
    synthetic: false,
  });
  expect(Object.keys(events[0].payload).sort()).toEqual([
    'claimId',
    'initiator_id',
    'initiator_kind',
    'state',
    'synthetic',
    'version',
  ]);
  expect(JSON.stringify(events[0].payload)).not.toContain('SECRET');
});

test('redaction of an approved claim keeps the active link: the customer still sees the company, the staff reason is hidden', async () => {
  const c = await w.freshWriter('rd3', 'Nonesuch Handel GmbH');
  const org = await s.ingest('real', s.identity('real', 'Redact Active GmbH'), 'other');
  w.org.RA = org.id;
  const claim = await w.fileExisting('F-rd3', c.who, 'real', 'RA');
  await w.approve('real', claim, 'RA', { reason: 'Reason text staff wrote' });
  await redact('owner', redactInput(claim));
  const view = await w.link(c.who, 'real').view({ workspaceId: c.workspaceId });
  expect(view.status).toBe('approved');
  expect(view.link).toMatchObject({
    organisation: { name: 'Redact Active GmbH', country: 'DE' },
    reason: hidden,
  });
  expect(JSON.stringify(view)).not.toContain('Reason text staff wrote');
  const ledger = await w.f.owner.query(
    'SELECT state FROM customer_private.organisation_link WHERE tenant_id=$1 ORDER BY version DESC LIMIT 1',
    [c.workspaceId],
  );
  expect(ledger.rows[0].state).toBe('linked');
});

test('a real redaction needs real use to be on (KI-41), and a sample claim redacts under the sample intake', async () => {
  const c = await closedClaim('rd4');
  await reject(c.claim);
  const set = async (enabled: boolean) => {
    const db = await w.f.owner.connect();
    try {
      await db.query('BEGIN');
      await db.query('ALTER TABLE customer_private.real_use_configuration DISABLE TRIGGER USER');
      await db.query('UPDATE customer_private.real_use_configuration SET enabled=$1', [enabled]);
      await db.query('ALTER TABLE customer_private.real_use_configuration ENABLE TRIGGER USER');
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  };
  await set(false);
  try {
    await expect(redact('owner', redactInput(c.claim))).rejects.toMatchObject({ code: '42501' });
    await expect(
      s.fn(s.ctx('owner', 'real'), 'app.customer_organisation_link_closed_claims', c.workspaceId),
    ).rejects.toMatchObject({ code: '42501' });
  } finally {
    await set(true);
  }
  await expect(redact('owner', redactInput(c.claim))).resolves.toMatchObject({ redacted: true });
  // The sample side needs no real-use setting: the sample claim CS1 is open, so it is refused for that reason only.
  await expect(
    s.fn(
      s.ctx('owner', 'synthetic'),
      'app.customer_organisation_link_redact',
      randomUUID(),
      JSON.stringify(redactInput(w.claim.CS1!)),
    ),
  ).rejects.toMatchObject({
    message: 'Reject the claim before redacting it',
  });
  // A claim of the other side is not found.
  await expect(redact('owner', redactInput(w.claim.CS1!))).rejects.toMatchObject({
    message: 'Company link request unavailable',
  });
  await expect(redact('owner', redactInput(randomUUID()))).rejects.toMatchObject({
    message: 'Company link request unavailable',
  });
});

test('the closed-claims lookup works with the customer switch off, lists closed claims without text, flags redaction and gives one empty answer', async () => {
  vi.stubEnv('CORRIDRA_CUSTOMER_ORGANISATION_LINKS_ENABLED', '');
  const c = await closedClaim('cl1');
  await reject(c.claim);
  // A second, open claim of the same workspace is not listed.
  const open = (
    await w.link(c.who, 'real').command({
      action: 'file',
      commandId: randomUUID(),
      workspaceId: c.workspaceId,
      expectedProfileVersion: 1,
      kind: 'PROPOSED_NEW',
      organisationId: null,
      note: 'Second private note',
    })
  ).claim!.id!;
  const lookup = (who: Who, workspace: string | null, side: 'real' | 'synthetic' = 'real') =>
    s.fn(s.ctx(who, side), 'app.customer_organisation_link_closed_claims', workspace);
  const listed = await lookup('owner', c.workspaceId);
  expect(listed.claims).toHaveLength(1);
  expect(listed.claims[0]).toMatchObject({
    claimId: c.claim,
    state: 'rejected',
    version: 2,
    redacted: false,
  });
  expect(Object.keys(listed.claims[0]).sort()).toEqual([
    'claimId',
    'createdAt',
    'redacted',
    'state',
    'updatedAt',
    'version',
  ]);
  expect(JSON.stringify(listed)).not.toContain(open);
  expect(JSON.stringify(listed)).not.toContain('Private note');
  await redact('owner', redactInput(c.claim));
  expect((await lookup('owner', c.workspaceId)).claims[0].redacted).toBe(true);
  // An approved claim is closed and listed.
  const approvedWorkspace = w.ws.WR2!;
  expect(
    (await lookup('owner', approvedWorkspace)).claims.map((x: { state: string }) => x.state),
  ).toContain('approved');
  // Unknown, other-side, null and no-closed-claim workspaces answer the same bytes.
  const empty = JSON.stringify({ claims: [] });
  for (const workspace of [randomUUID(), w.ws.WS1!, w.ws.WS2!, w.ws.WR3!, null])
    expect(JSON.stringify(await lookup('owner', workspace)), String(workspace)).toBe(empty);
  expect(JSON.stringify(await lookup('owner', w.ws.WR2!, 'synthetic'))).toBe(empty);
  // Reviewer, operator, viewer and staff of another tenant are denied.
  for (const who of ['reviewer', 'operator', 'viewer', 'other'] as const)
    await expect(lookup(who, c.workspaceId), who).rejects.toMatchObject({ code: '42501' });
  await withMfa('owner', '10 minutes', async () => {
    await expect(lookup('owner', c.workspaceId)).rejects.toMatchObject({ code: '42501' });
  });
  vi.unstubAllEnvs();
});

test('the redaction and takedown functions refuse a call with no staff session, and have no grant for PUBLIC or the auth login', async () => {
  for (const [sql, args] of [
    [
      'SELECT app.customer_organisation_link_redact($1,$2)',
      [randomUUID(), JSON.stringify(redactInput(randomUUID()))],
    ],
    ['SELECT app.customer_organisation_link_closed_claims($1)', [randomUUID()]],
  ] as const)
    await expect(w.f.runtime.query(sql, [...args])).rejects.toMatchObject({ code: '42501' });
  for (const sql of [
    'SELECT app.customer_organisation_link_redact($1,$2)',
    'SELECT app.customer_organisation_suppress($1,$2)',
    'SELECT app.adjust_organisation_source_rights($1,$2)',
  ])
    await expect(w.f.auth.query(sql, [randomUUID(), '{}'])).rejects.toMatchObject({
      code: '42501',
    });
});
