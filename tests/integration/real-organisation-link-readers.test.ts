import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { hidden, World } from './organisation-link-support';
import type {
  StaffOrganisationLinkQueue,
  StaffOrganisationLinkReview,
} from '../../packages/auth/src/customer-organisation-links';

// ADR-079 slice A, readers and decision paths. The ladder file under test is hidden while the world is built at the
// base state and applied afterwards (see organisation-link-support.ts). LINK_BASE_CHECK=1 never applies it.
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
    return (globalThis as { __linkHide?: boolean }).__linkHide &&
      String(path).includes('customer-real-use-migrations')
      ? names.filter((n) => !String(n).startsWith('0013_organisation_link_provenance_and_search'))
      : names;
  }) as typeof real.readdir;
  return { ...real, readdir, default: { ...real, readdir } };
});

let w: World;
const text = (value: unknown) => JSON.stringify(value);
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
// The staff answers carry a redacted flag that the application types do not list yet (the types are slice B scope).
type Review = StaffOrganisationLinkReview & { redacted: boolean };
type Queue = Omit<StaffOrganisationLinkQueue, 'items'> & {
  items: (StaffOrganisationLinkQueue['items'][number] & { redacted: boolean })[];
};
const reviewOf = async (ctx: World['rsCtx'], claimId: string) =>
  (await w.staff().review(ctx, claimId)) as Review;
const queueOf = async (ctx: World['rsCtx'], input: object) =>
  (await w.staff().queue(ctx, input)) as Queue;
const rowOf = (queue: Queue, claimId: string) => {
  const row = queue.items.find((item) => item.claimId === claimId);
  if (!row) throw new Error('The claim is not in the queue');
  return row;
};
beforeAll(async () => {
  w = await World.build('corridra_integration');
  await w.install();
  // OR3 is hidden and OR6, which has an active link, is hidden later: rows made as table owner (the writers are slice B).
  await w.suppress('OR3');
  await w.suppress('OR6');
}, 300000);
afterAll(async () => {
  await w?.close();
});
// An insert as table owner that is always rolled back, so a refusal and a success both leave the world as it was.
async function ownerAttempt(sql: string, args: unknown[]) {
  const db = await w.f.owner.connect();
  try {
    await db.query('BEGIN');
    await db.query(sql, args);
    return 'accepted';
  } catch (error) {
    return (error as Error).message;
  } finally {
    await db.query('ROLLBACK');
    db.release();
  }
}
const decideAs = (mode: 'real' | 'synthetic', claimId: string, version: number, over: object) =>
  w.staff().decide(w.ctxFor(mode), {
    commandId: randomUUID(),
    claimId,
    expectedVersion: version,
    decision: 'approve',
    reason: 'Reviewed the supplied evidence against the catalogue record',
    internalNote: null,
    organisationId: null,
    shareConfirmed: false,
    ...over,
  });

test('candidates (rows 3, 4 and 5): each side sees only its own organisations, claims and linked workspaces', async () => {
  const real = await reviewOf(w.rsCtx, w.claim.CR1!);
  expect(ids(real.candidates.organisations)).toEqual([w.org.OR1]);
  expect(real.candidates.organisations[0]).toMatchObject({
    reasons: ['name_country', 'website_host', 'chosen_by_customer'],
    linkedWorkspaces: 1,
  });
  expect(real.candidates.workspaces.map((c) => c.claimId)).toEqual([w.claim.CR2]);
  expect(real.candidates.workspaces[0].workspaceId).toBe(w.ws.WR2);
  const synthetic = await reviewOf(w.ssCtx, w.claim.CS1!);
  expect(ids(synthetic.candidates.organisations)).toEqual([w.org.OS1]);
  expect(synthetic.candidates.organisations[0]).toMatchObject({
    reasons: ['name_country'],
    linkedWorkspaces: 1,
  });
  expect(synthetic.candidates.workspaces.map((c) => c.claimId)).toEqual([w.claim.CS2]);
  expect(synthetic.candidates.workspaces[0].workspaceId).toBe(w.ws.WS2);
});

test('queue (row 6) lists only the session side and counts the fixed candidates', async () => {
  const real = await queueOf(w.rsCtx, { scope: 'open' });
  expect(real.items.map((i) => i.claimId)).toEqual([w.claim.CR1]);
  expect(real.items[0].candidateCount).toBe(2);
  expect(real.items[0].redacted).toBe(false);
  const synthetic = await queueOf(w.ssCtx, { scope: 'open' });
  expect(synthetic.items.map((i) => i.claimId)).toEqual([w.claim.CS1]);
  expect(synthetic.items[0].candidateCount).toBe(2);
});

test('review across sides reads as not found (row 7), and a link to an organisation of the other side is not named (7b, O1, O2)', async () => {
  await expect(reviewOf(w.rsCtx, w.claim.CS1!)).rejects.toThrow(/Company link request unavailable/);
  await expect(reviewOf(w.ssCtx, w.claim.CR1!)).rejects.toThrow(/Company link request unavailable/);
  const before = await w.crossHash(w.ws.WR4!);
  const cr4 = await reviewOf(w.rsCtx, w.claim.CR4!);
  expect(cr4).toMatchObject({ chosenOrganisation: null, activeLink: null, decisions: ['revoke'] });
  expect(ids(cr4.candidates.organisations)).toEqual([]);
  const cs3 = await reviewOf(w.ssCtx, w.claim.CS3!);
  expect(cs3).toMatchObject({ chosenOrganisation: null, activeLink: null, decisions: ['revoke'] });
  expect(ids(cs3.candidates.organisations)).not.toContain(w.org.OR1);
  await expect(
    decideAs('real', w.claim.CR4!, cr4.version, { organisationId: w.org.OS1 }),
  ).rejects.toThrow(/not in the catalogue/);
  await expect(
    decideAs('synthetic', w.claim.CS3!, cs3.version, { organisationId: w.org.OR1 }),
  ).rejects.toThrow(/not in the catalogue/);
  expect(await w.crossHash(w.ws.WR4!)).toBe(before);
  const queue = await queueOf(w.rsCtx, { scope: 'closed' });
  const cr4Row = rowOf(queue, w.claim.CR4!);
  expect(cr4Row.candidateCount).toBe(0);
});

test('answers carry no name or id of the other side (row 10)', async () => {
  const real: unknown[] = [
    await queueOf(w.rsCtx, { scope: 'open' }),
    await queueOf(w.rsCtx, { scope: 'closed' }),
  ];
  for (const claim of ['CR1', 'CR2', 'CR4', 'CR6', 'CRP'])
    real.push(await reviewOf(w.rsCtx, w.claim[claim]!));
  const realText = text(real);
  for (const needle of [
    'Acme Realwerk AG',
    'Orchid',
    'Synthetic Acme',
    'Synthetic Sigma',
    'Synthetic Pilot',
    w.org.OS1,
    w.org.OS2,
    w.org.OS3,
    w.ws.WS1,
    w.ws.WS2,
    w.ws.WS3,
    w.ws.WSP,
  ])
    expect(realText).not.toContain(needle);
  const synthetic: unknown[] = [
    await queueOf(w.ssCtx, { scope: 'open' }),
    await queueOf(w.ssCtx, { scope: 'closed' }),
  ];
  for (const claim of ['CS1', 'CS2', 'CS3', 'CSP'])
    synthetic.push(await reviewOf(w.ssCtx, w.claim[claim]!));
  const syntheticText = text(synthetic);
  for (const needle of [
    'Acme Realwerk GmbH',
    'Zeta',
    'Omega',
    'Pilot Realwerk',
    w.org.OR1,
    w.org.OR5,
    w.ws.WR1,
    w.ws.WR2,
    w.ws.WR3,
    w.ws.WR4,
    w.ws.WRP,
  ])
    expect(syntheticText).not.toContain(needle);
});

test('a cross-provenance link keeps its status but names no organisation, in the view and the overview (O8)', async () => {
  const lx = await w.link('carol-r', 'real').view({ workspaceId: w.ws.WR3 });
  expect(lx.status).toBe('approved');
  expect(lx.link).not.toBeNull();
  expect((lx.link as { organisation: unknown }).organisation).toBeNull();
  expect(text(lx)).not.toContain('Orchid');
  const lx3 = await w.link('carl-s', 'synthetic').view({ workspaceId: w.ws.WS3 });
  expect(lx3.status).toBe('approved');
  expect((lx3.link as { organisation: unknown }).organisation).toBeNull();
  expect(text(lx3)).not.toContain('Acme Realwerk GmbH');
  const overview = await w.link('carol-r', 'real').overview();
  const row = overview.workspaces.find((x) => x.workspaceId === w.ws.WR3);
  expect(row).toMatchObject({ status: 'approved' });
  expect((row as { organisationName?: string | null }).organisationName ?? null).toBeNull();
  // The same workspaces still read normally for ordinary links.
  const own = await w.link('bob-r', 'real').view({ workspaceId: w.ws.WR2 });
  expect((own.link as { organisation: { name: string } }).organisation.name).toBe(
    'Acme Realwerk GmbH',
  );
  expect(own.link!.label).not.toContain('synthetic');
});

test('person P sees each workspace by its own side (rows 11 and 11b)', async () => {
  const p = w.link('dana', 'real');
  const real = await p.view({ workspaceId: w.ws.WRP });
  const synthetic = await p.view({ workspaceId: w.ws.WSP });
  expect((real.link as { organisation: { name: string } }).organisation.name).toBe(
    'Pilot Realwerk GmbH',
  );
  expect(real.link!.label).not.toContain('synthetic test');
  expect((synthetic.link as { organisation: { name: string } }).organisation.name).toBe(
    'Pilot Synthwerk AG',
  );
  expect(synthetic.link!.label).toContain('synthetic test');
  // Search follows the workspace asked about: the same person finds the real company on one and the synthetic one on the other.
  expect(ids((await p.search({ workspaceId: w.ws.WRP, q: 'pilot' })).organisations)).toEqual([
    w.org.OR5,
  ]);
  expect(ids((await p.search({ workspaceId: w.ws.WSP, q: 'pilot' })).organisations)).toEqual([
    w.org.OS3,
  ]);
  const overview = await p.overview();
  const byId = new Map(overview.workspaces.map((x) => [x.workspaceId, x]));
  expect(byId.get(w.ws.WRP)).toMatchObject({ organisationName: 'Pilot Realwerk GmbH' });
  expect(byId.get(w.ws.WSP)).toMatchObject({ organisationName: 'Pilot Synthwerk AG' });
});

test('filing to an organisation of the other side, a hidden one or an unlisted one is refused (rows 9, O3, O4)', async () => {
  const file = (who: string, mode: 'real' | 'synthetic', key: string, org: string) =>
    w.fileExisting(key, who, mode, org);
  await expect(file('erin-r', 'real', 'WR5', 'OS1')).rejects.toThrow(
    /That organisation cannot be requested/,
  );
  await expect(file('erin-r', 'real', 'WR5', 'OR3')).rejects.toThrow(
    /That organisation cannot be requested/,
  );
  await expect(file('carl-s', 'synthetic', 'WS3', 'OR1')).rejects.toThrow(
    /That organisation cannot be requested/,
  );
  // O3: the organisation is hidden after it was linked. The linked workspace keeps its name, new filings are refused.
  await expect(file('frank-r', 'real', 'WR6', 'OR6')).rejects.toThrow(
    /That organisation cannot be requested/,
  );
  const kept = await w.link('frank-r', 'real').view({ workspaceId: w.ws.WR6 });
  expect((kept.link as { organisation: { name: string } }).organisation.name).toBe(
    'Epsilon Linked GmbH',
  );
  // O4: an organisation with an expired identifier cannot be requested but staff still list it and may approve it.
  await w.addOrganisation({
    key: 'ORX',
    name: 'Beta Werke GmbH',
    synthetic: false,
    host: 'beta-werke-two.de',
    expired: true,
  });
  await w.workspace('WR8', 'heidi-r', 'real', 'Beta Werke GmbH', null);
  await expect(file('heidi-r', 'real', 'WR8', 'ORX')).rejects.toThrow(
    /That organisation cannot be requested/,
  );
  const claim = (
    await w.link('heidi-r', 'real').command({
      action: 'file',
      commandId: randomUUID(),
      workspaceId: w.ws.WR8,
      expectedProfileVersion: 1,
      kind: 'PROPOSED_NEW',
      organisationId: null,
      note: 'Review our company information',
    })
  ).claim!.id!;
  const review = await reviewOf(w.rsCtx, claim);
  expect(ids(review.candidates.organisations).sort()).toEqual([w.org.OR2, w.org.ORX].sort());
  const queue = await queueOf(w.rsCtx, { scope: 'open' });
  const row = rowOf(queue, claim);
  expect(row.candidateCount).toBe(2);
  const approved = await decideAs('real', claim, review.version, { organisationId: w.org.ORX });
  expect(approved).toMatchObject({ state: 'approved', shared: false });
});

test('the first check of a command needs no context, the rest wait for the role check (row 11c)', async () => {
  const p = w.link('dana', 'real');
  const file = (workspaceId: string, note: string, who = p) =>
    who.command({
      action: 'file',
      commandId: randomUUID(),
      workspaceId,
      expectedProfileVersion: 1,
      kind: 'PROPOSED_NEW',
      organisationId: null,
      note,
    });
  await expect(file(w.ws.WSP!, 'Hi')).rejects.toThrow(/Invalid company link request/);
  const accepted = await file(w.ws.WRP!, 'Hi');
  expect(accepted.status).toBe('pending');
  expect(accepted.claim!.note).toBe('Hi');
  // A caller with no role on the workspace gets the role denial before any content error.
  for (const target of [w.ws.WRP!, w.ws.WSP!]) {
    const denied = await file(target, 'x', w.link('erin-r', 'real')).then(
      () => null,
      (error: Error) => error,
    );
    expect(denied).not.toBeNull();
    expect(denied!.message).not.toMatch(/Invalid company link request/);
  }
});

test('ledger guard and decide refuse the other side and hidden organisations (rows 8, 8b, 8c)', async () => {
  const review = await reviewOf(w.rsCtx, w.claim.CR1!);
  await expect(
    decideAs('real', w.claim.CR1!, review.version, { organisationId: w.org.OS1 }),
  ).rejects.toThrow(/not in the catalogue/);
  const cs = await reviewOf(w.ssCtx, w.claim.CS1!);
  await expect(
    decideAs('synthetic', w.claim.CS1!, cs.version, { organisationId: w.org.OR1 }),
  ).rejects.toThrow(/not in the catalogue/);
  await expect(
    decideAs('real', w.claim.CR1!, review.version, { organisationId: w.org.OR3 }),
  ).rejects.toThrow(/That organisation is not available for linking/);
  expect((await reviewOf(w.rsCtx, w.claim.CR1!)).state).toBe('pending');
  const insert = `INSERT INTO customer_private.organisation_link(tenant_id,version,state,claim_id,organisation_id,shared,staff_actor) VALUES($1,1,'linked',$2,$3,false,$4)`;
  const staff = w.f.users.reviewer.id;
  const message = /That organisation is not available for linking/;
  expect(await ownerAttempt(insert, [w.ws.WR1, w.claim.CR1, w.org.OS1, staff])).toMatch(message);
  expect(await ownerAttempt(insert, [w.ws.WS1, w.claim.CS1, w.org.OR1, staff])).toMatch(message);
  expect(await ownerAttempt(insert, [w.ws.WR1, w.claim.CR1, w.org.OR3, staff])).toMatch(message);
  expect(await ownerAttempt(insert, [w.ws.WR1, w.claim.CR1, w.org.OR2, staff])).toBe('accepted');
});

test('the paging probe of the queue is scoped to the session side', async () => {
  await expect(queueOf(w.ssCtx, { scope: 'closed', after: w.claim.CR2 })).rejects.toThrow(
    /Invalid queue request/,
  );
  await expect(queueOf(w.rsCtx, { scope: 'closed', after: w.claim.CS2 })).rejects.toThrow(
    /Invalid queue request/,
  );
  const page = await queueOf(w.rsCtx, { scope: 'closed', pageSize: 1 });
  expect(page.items).toHaveLength(1);
  const next = await queueOf(w.rsCtx, { scope: 'closed', after: page.nextAfter! });
  expect(next.items.length).toBeGreaterThan(0);
});

test('redaction: every reader masks the claim text, the replay never returns stored text, an active link survives (O5, O12)', async () => {
  const who = 'grace-r';
  await w.workspace('WR7', who, 'real', 'Grace Handel GmbH', 'https://www.grace-handel.de');
  const person = w.link(who, 'real');
  const fileA = {
    action: 'file' as const,
    commandId: randomUUID(),
    workspaceId: w.ws.WR7!,
    expectedProfileVersion: 1,
    kind: 'EXISTING' as const,
    organisationId: w.org.OR4!,
    note: 'Private note about Grace Handel',
  };
  const a = (await person.command(fileA)).claim!.id!;
  const evidenceA = {
    action: 'add_evidence' as const,
    commandId: randomUUID(),
    workspaceId: w.ws.WR7!,
    claimId: a,
    expectedVersion: 1,
    evidenceKind: 'WEBSITE_STATEMENT' as const,
    statement: 'Statement with private words of Grace',
    url: 'https://business.test/grace',
  };
  await person.command(evidenceA);
  const review = await reviewOf(w.rsCtx, a);
  expect(ids(review.candidates.organisations)).toContain(w.org.OR4);
  await decideAs('real', a, review.version, {
    organisationId: w.org.OR4,
    reason: 'Reason text staff wrote about Grace',
    internalNote: 'Internal staff words about Grace',
  });
  const fileB = {
    action: 'file' as const,
    commandId: randomUUID(),
    workspaceId: w.ws.WR7!,
    expectedProfileVersion: 1,
    kind: 'PROPOSED_NEW' as const,
    organisationId: null,
    note: 'Second claim note',
  };
  const b = (await person.command(fileB)).claim!.id!;
  const evidenceB = {
    action: 'add_evidence' as const,
    commandId: randomUUID(),
    workspaceId: w.ws.WR7!,
    claimId: b,
    expectedVersion: 1,
    evidenceKind: 'REGISTRATION_STATEMENT' as const,
    statement: 'Second claim statement',
    url: null,
  };
  const stored = await person.command(evidenceB);
  expect((stored.link as { reason?: string }).reason).toBe('Reason text staff wrote about Grace');
  await w.redact(a);
  // Customer state.
  const view = await person.view({ workspaceId: w.ws.WR7 });
  expect(view.link).toMatchObject({
    organisation: { name: 'Delta Bau GmbH', country: 'DE' },
    reason: hidden,
  });
  expect(view.link!.label).toBeTruthy();
  expect(text(view)).not.toContain('Reason text staff wrote');
  // Replays of both stored receipts are rebuilt from the masked state.
  for (const command of [fileA, evidenceB, evidenceA]) {
    const replay = await person.command(command);
    expect(replay.commandId).toBe(command.commandId);
    expect(replay.canEdit).toBe(true);
    expect(text(replay)).not.toContain('Reason text staff wrote');
    expect(text(replay)).not.toContain('Private note about Grace');
    expect(text(replay)).not.toContain('private words of Grace');
    expect((replay.link as { reason?: string }).reason).toBe(hidden);
  }
  await expect(person.command({ ...fileB, commandId: fileA.commandId })).rejects.toThrow(
    /conflicts/,
  );
  // Staff review of the redacted claim.
  const masked = await reviewOf(w.rsCtx, a);
  expect(masked.redacted).toBe(true);
  expect(masked.note).toBe(hidden);
  expect(masked.profile).toMatchObject({ legalName: hidden, website: hidden, summary: hidden });
  expect(masked.evidence.map((e) => [e.statement, e.url])).toEqual([[hidden, hidden]]);
  for (const h of masked.history) {
    if (h.reason !== null) expect(h.reason).toBe(hidden);
    if (h.internalNote !== null) expect(h.internalNote).toBe(hidden);
  }
  expect(masked.candidates).toEqual({ organisations: [], workspaces: [] });
  expect(masked.decisions).toEqual(['revoke']);
  expect(masked.activeLink?.organisation.name).toBe('Delta Bau GmbH');
  const maskedText = text(masked);
  for (const secret of [
    'Private note',
    'private words',
    'Reason text',
    'Internal staff',
    'grace-handel.de',
  ])
    expect(maskedText).not.toContain(secret);
  // The second claim is not redacted and keeps its own text.
  const second = await reviewOf(w.rsCtx, b);
  expect(second.redacted).toBe(false);
  expect(second.note).toBe('Second claim note');
  expect(second.profile.legalName).toBe('Grace Handel GmbH');
  // Staff queue.
  const closed = await queueOf(w.rsCtx, { scope: 'closed' });
  const row = rowOf(closed, a);
  expect(row).toMatchObject({ redacted: true, legalName: hidden, state: 'approved' });
});

test('approval of a same-side claim to an organisation that only the other side links is not a shared link (row 8d)', async () => {
  const review = await reviewOf(w.ssCtx, w.claim.CS1!);
  const outcome = await decideAs('synthetic', w.claim.CS1!, review.version, {
    organisationId: w.org.OS2,
  });
  expect(outcome).toMatchObject({ state: 'approved', shared: false });
  const ledger = await w.f.owner.query(
    'SELECT shared FROM customer_private.organisation_link WHERE tenant_id=$1 ORDER BY version DESC LIMIT 1',
    [w.ws.WS1],
  );
  expect(ledger.rows[0].shared).toBe(false);
});

test('a redacted claim drops out of the candidates of other claims (O7)', async () => {
  const before = await reviewOf(w.rsCtx, w.claim.CR1!);
  expect(before.candidates.workspaces).toHaveLength(1);
  const count = rowOf(await queueOf(w.rsCtx, { scope: 'open' }), w.claim.CR1!).candidateCount;
  expect(count).toBe(2);
  await w.redact(w.claim.CR2!);
  const after = await reviewOf(w.rsCtx, w.claim.CR1!);
  expect(after.candidates.workspaces).toHaveLength(0);
  const reduced = rowOf(await queueOf(w.rsCtx, { scope: 'open' }), w.claim.CR1!).candidateCount;
  expect(reduced).toBe(1);
  expect(after.candidates.organisations[0].linkedWorkspaces).toBe(1);
});

test('staff can still end a cross-provenance link and a link whose organisation was hidden (8e, O3)', async () => {
  const lx2 = await reviewOf(w.rsCtx, w.claim.CR4!);
  expect(lx2).toMatchObject({ chosenOrganisation: null, activeLink: null, decisions: ['revoke'] });
  const ended = await decideAs('real', w.claim.CR4!, lx2.version, {
    decision: 'revoke',
    organisationId: null,
  });
  expect(ended).toMatchObject({ decision: 'revoke', state: 'ended' });
  const rows = (
    await w.f.owner.query(
      'SELECT version,state FROM customer_private.organisation_link WHERE tenant_id=$1 ORDER BY version',
      [w.ws.WR4],
    )
  ).rows;
  expect(rows.map((r) => r.state)).toEqual(['linked', 'unlinked']);
  const events = await w.f.owner.query(
    "SELECT kind FROM customer_private.organisation_link_event WHERE claim_id=$1 AND kind='link_ended'",
    [w.claim.CR4],
  );
  expect(events.rowCount).toBe(1);
  const cr6 = await reviewOf(w.rsCtx, w.claim.CR6!);
  expect(cr6.decisions).toEqual(['revoke']);
  const endedHidden = await decideAs('real', w.claim.CR6!, cr6.version, {
    decision: 'revoke',
    organisationId: null,
  });
  expect(endedHidden.state).toBe('ended');
});
