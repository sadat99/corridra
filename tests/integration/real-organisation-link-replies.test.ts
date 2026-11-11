import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { hidden, World } from './organisation-link-support';
import {
  parseLinkOverview,
  parseLinkSearch,
  parseLinkView,
  staffOutcomeSchema,
  staffQueueSchema,
  staffReviewSchema,
} from '../../apps/web/lib/organisation-link-replies';

// ADR-079 slice A. Real output of the replaced functions, with the new file applied, is read by the same checks the
// browser uses (apps/web/lib/organisation-link-replies.ts). A key that SQL adds and a check refuses fails here.
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
      ? // Real-use 0014 (removed member access) is applied after 0013, so it stays hidden together with it and the
        // exact base state of this suite is unchanged. Owner decision 11 Nov 2026, "No, remove access (Recommended)".
        names.filter(
          (n) => !/^(0013_organisation_link_provenance_and_search|0014_)/.test(String(n)),
        )
      : names;
  }) as typeof real.readdir;
  return { ...real, readdir, default: { ...real, readdir } };
});

let w: World;
// A rejected claim with text on it, and an open one, both hidden by a redaction row made as table owner.
const text = { rejected: 'Kate private note', open: 'Lena private note' };
beforeAll(async () => {
  w = await World.build('corridra_integration');
  await w.install();
}, 300000);
afterAll(async () => {
  await w?.close();
});
const decide = (claimId: string, version: number, over: object) =>
  w.staff().decide(w.rsCtx, {
    commandId: randomUUID(),
    claimId,
    expectedVersion: version,
    decision: 'reject',
    reason: 'Reviewed the supplied evidence against the catalogue record',
    internalNote: 'Internal staff words',
    organisationId: null,
    shareConfirmed: false,
    ...over,
  });
// A workspace with a claim that has text on it, evidence and a staff reason.
async function workspaceWithClaim(key: string, who: string, note: string, closed: boolean) {
  await w.workspace(key, who, 'real', `${who} Handel GmbH`, null);
  const person = w.link(who, 'real');
  const file = await person.command({
    action: 'file',
    commandId: randomUUID(),
    workspaceId: w.ws[key],
    expectedProfileVersion: 1,
    kind: 'PROPOSED_NEW',
    organisationId: null,
    note,
  });
  const claimId = file.claim!.id!;
  const evidenceCommand = {
    action: 'add_evidence' as const,
    commandId: randomUUID(),
    workspaceId: w.ws[key]!,
    claimId,
    expectedVersion: 1,
    evidenceKind: 'WEBSITE_STATEMENT' as const,
    statement: 'Private statement of ' + who,
    url: 'https://business.test/' + who,
  };
  await person.command(evidenceCommand);
  const review = await w.staff().review(w.rsCtx, claimId);
  await decide(claimId, review.version, {
    decision: closed ? 'reject' : 'request_evidence',
    reason: 'Private reason for ' + who,
  });
  if (!closed)
    await person.command({
      action: 'add_evidence',
      commandId: randomUUID(),
      workspaceId: w.ws[key],
      claimId,
      expectedVersion: 3,
      evidenceKind: 'WEBSITE_STATEMENT',
      statement: 'Second private statement of ' + who,
      url: null,
    });
  return { person, claimId, file, evidenceCommand };
}

test('the staff queue and every review parse, plain and redacted, on both sides', async () => {
  const rejected = await workspaceWithClaim('WK', 'kate-r', text.rejected, true);
  const open = await workspaceWithClaim('WL', 'lena-r', text.open, false);
  const plain = await staffQueueSchema.parseAsync(
    await w.staff().queue(w.rsCtx, { scope: 'open' }),
  );
  expect(plain.items.map((i) => i.redacted)).toEqual(plain.items.map(() => false));
  expect(plain.items.length).toBeGreaterThan(0);
  await w.redact(rejected.claimId);
  await w.redact(open.claimId);
  const closed = staffQueueSchema.parse(await w.staff().queue(w.rsCtx, { scope: 'closed' }));
  expect(closed.items.find((i) => i.claimId === rejected.claimId)).toMatchObject({
    redacted: true,
    legalName: hidden,
  });
  expect(closed.items.some((i) => i.redacted === false)).toBe(true);
  const openAfter = staffQueueSchema.parse(await w.staff().queue(w.rsCtx, { scope: 'open' }));
  expect(openAfter.items.find((i) => i.claimId === open.claimId)?.redacted).toBe(true);
  // Reviews: plain, a link to an organisation of the other side (null organisation), and both redacted claims.
  for (const claim of [w.claim.CR1, w.claim.CR2, w.claim.CR4, w.claim.CRP]) {
    const parsed = staffReviewSchema.parse(await w.staff().review(w.rsCtx, claim!));
    expect(parsed.redacted).toBe(false);
  }
  for (const id of [rejected.claimId, open.claimId]) {
    const parsed = staffReviewSchema.parse(await w.staff().review(w.rsCtx, id));
    expect(parsed).toMatchObject({ redacted: true, note: hidden });
    expect(parsed.profile.legalName).toBe(hidden);
    expect(
      parsed.evidence.every((e) => e.statement === hidden && (e.url === null || e.url === hidden)),
    ).toBe(true);
  }
  // The synthetic side.
  const syntheticQueue = staffQueueSchema.parse(
    await w.staff().queue(w.ssCtx, { scope: 'closed' }),
  );
  expect(syntheticQueue.synthetic).toBe(true);
  for (const claim of [w.claim.CS1, w.claim.CS2, w.claim.CS3])
    expect(staffReviewSchema.parse(await w.staff().review(w.ssCtx, claim!)).redacted).toBe(false);
  // A decision outcome.
  const review = await w.staff().review(w.rsCtx, w.claim.CR1!);
  const outcome = await decide(w.claim.CR1!, review.version, {
    decision: 'request_evidence',
    internalNote: null,
  });
  expect(staffOutcomeSchema.parse(outcome).state).toBe('needs_evidence');
});

test('the customer view, command result, overview and search parse, plain and redacted', async () => {
  // Redacted, rejected: the workspace made above is read again here, so this test also stands alone.
  const rejected = await workspaceWithClaim('WK2', 'mara-r', text.rejected, true);
  const open = await workspaceWithClaim('WL2', 'nina-r', text.open, false);
  const plainView = parseLinkView(await rejected.person.view({ workspaceId: w.ws.WK2 }), w.ws.WK2!);
  expect(plainView.claim?.redacted).toBeUndefined();
  await w.redact(rejected.claimId);
  await w.redact(open.claimId);
  const hiddenRejected = parseLinkView(
    await rejected.person.view({ workspaceId: w.ws.WK2 }),
    w.ws.WK2!,
  );
  expect(hiddenRejected.claim).toMatchObject({ redacted: true, note: hidden });
  const hiddenOpen = parseLinkView(await open.person.view({ workspaceId: w.ws.WL2 }), w.ws.WL2!);
  expect(hiddenOpen.claim).toMatchObject({ redacted: true, note: hidden, state: 'pending' });
  // Command results and a replay of a stored receipt after the redaction.
  parseLinkView(rejected.file, w.ws.WK2!);
  const replayed = parseLinkView(
    await rejected.person.command(rejected.evidenceCommand),
    w.ws.WK2!,
  );
  expect(replayed.claim?.redacted).toBe(true);
  expect(replayed.workspaceId).toBe(w.ws.WK2);
  // A link whose organisation belongs to the other side keeps its status and shows no organisation.
  const crossSide = parseLinkView(
    await w.link('carol-r', 'real').view({ workspaceId: w.ws.WR3 }),
    w.ws.WR3!,
  );
  expect(crossSide.status).toBe('approved');
  expect(crossSide.link?.organisation).toBeNull();
  parseLinkView(await w.link('bob-r', 'real').view({ workspaceId: w.ws.WR2 }), w.ws.WR2!);
  parseLinkView(await w.link('alice-s', 'synthetic').view({ workspaceId: w.ws.WS1 }), w.ws.WS1!);
  // Overview, including the cross-provenance workspace with no organisation name.
  const overview = parseLinkOverview(await w.link('carol-r', 'real').overview());
  expect(overview[w.ws.WR3!]).toEqual({ status: 'approved', organisationName: null });
  const both = parseLinkOverview(await w.link('dana', 'real').overview());
  expect(both[w.ws.WRP!]?.organisationName).toBe('Pilot Realwerk GmbH');
  expect(both[w.ws.WSP!]?.organisationName).toBe('Pilot Synthwerk AG');
  // Search.
  const found = parseLinkSearch(
    await w.link('alice-r', 'real').search({ workspaceId: w.ws.WR1, q: 'acme' }),
    w.ws.WR1!,
  );
  expect(found.map((o) => o.id)).toEqual([w.org.OR1]);
  expect(() =>
    parseLinkSearch({ workspaceId: randomUUID(), organisations: [] }, w.ws.WR1!),
  ).toThrow();
});
