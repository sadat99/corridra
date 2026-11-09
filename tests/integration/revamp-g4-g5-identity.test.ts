import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fixture } from './support';
import { harness, options, type Fixture } from './revamp-g4-support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerAccountLifecycle } from '../../packages/db/src/customer-account-lifecycle-migrate';
import { CustomerAccountLifecycleService } from '../../packages/auth/src/customer-account-lifecycle';
import { CustomerWorkspaceLifecycleService } from '../../packages/auth/src/customer-workspace-lifecycle';
import { recentSignInWords } from '../../packages/auth/src/customer-session';

// CRUD G4 and G5 follow-up, the customer side: every state-changing lifecycle command and every lifecycle state read names
// the person the page was drawn for, so a stale page of one account cannot act on another that signed in elsewhere; closing,
// archiving and handing over a workspace need a recent sign-in; and a closed person can still ask for erasure.
let f: Fixture;
let h: ReturnType<typeof harness>;
const phrase = 'Close my account';
const otherIssuer =
  'https://ep-other-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const minutes = (count: number) => new Date(Date.now() - count * 60000);

const accountService = (person: string, signedInAt: Date | null = new Date()) =>
  new CustomerAccountLifecycleService(f.runtime, f.auth, options, async () => ({
    ...h.session(person),
    signedInAt: signedInAt ?? undefined,
  }));
const workspaceService = (person: string, signedInAt: Date | null = new Date()) =>
  new CustomerWorkspaceLifecycleService(f.runtime, f.auth, options, async () => ({
    ...h.session(person),
    signedInAt: signedInAt ?? undefined,
  }));
const counts = async () =>
  (
    await f.owner.query(`SELECT
 (SELECT count(*)::int FROM customer_private.account_closure_event) closures,
 (SELECT count(*)::int FROM customer_private.account_lifecycle_request) requests,
 (SELECT count(*)::int FROM customer_private.erasure_request) erasures,
 (SELECT count(*)::int FROM customer_private.workspace_revision) revisions,
 (SELECT count(*)::int FROM customer_private.workspace_transfer_offer) offers,
 (SELECT count(*)::int FROM app.domain_event) events`)
  ).rows[0] as Record<string, number>;
const refusal = { status: 403, code: 'recent_sign_in_required' };

beforeAll(async () => {
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  await migrateCustomerAccountLifecycle(f.owner);
  h = harness(f, 'g45id');
  await h.admit(['ida', 'jay', 'kai', 'liv', 'mia', 'noa']);
  await h.setControl(true);
  await f.owner.query(
    'INSERT INTO customer_private.account_lifecycle_control(version,enabled,executor_id,reason) VALUES(1,true,$1,$2)',
    [f.serviceId, 'Fixture control for the identity tests'],
  );
  for (const person of ['ida', 'jay', 'kai', 'liv'])
    await h.provision(person, `Synthetic ${person} workspace`);
  // ida and kai have only an archived workspace, so they are free to close.
  for (const person of ['ida', 'kai']) {
    const [blocker] = (await accountService(person).state()).blockers;
    await h.lifecycle(person, 'archive', {
      workspaceId: blocker!.workspaceId,
      expectedVersion: 0,
      confirmName: blocker!.name,
    });
  }
});
afterAll(async () => {
  await f?.close();
});

describe('a command or read for another person is refused and writes nothing', () => {
  test.each([
    ['a different subject', 'synthetic-someone-else', options.issuer],
    ['a different issuer', h2subject('ida'), otherIssuer],
  ])(
    'close, undo and file_erasure with %s are 409 and leave the database as it was',
    async (_name, subject, issuer) => {
      await accountService('jay').command({ action: 'file_erasure', commandId: randomUUID() });
      const before = await counts();
      const wrong = { status: 409, message: 'Your account changed. Reload before continuing.' };
      await expect(
        accountService('ida').command(
          { action: 'close', commandId: randomUUID(), confirmation: phrase },
          subject,
          issuer,
        ),
      ).rejects.toMatchObject(wrong);
      await expect(
        accountService('ida').command({ action: 'undo', commandId: randomUUID() }, subject, issuer),
      ).rejects.toMatchObject(wrong);
      await expect(
        accountService('kai').command(
          { action: 'file_erasure', commandId: randomUUID() },
          subject,
          issuer,
        ),
      ).rejects.toMatchObject(wrong);
      await expect(accountService('ida').state(subject, issuer)).rejects.toMatchObject(wrong);
      expect(await counts()).toEqual(before);
    },
  );

  test('the matching pair is accepted', async () => {
    const subject = h.session('ida').subject;
    expect(await accountService('ida').state(subject, options.issuer)).toMatchObject({
      status: 'active',
    });
  });

  test('the workspace lifecycle refuses a forged pair the same way', async () => {
    const before = await counts();
    await expect(
      workspaceService('liv').command(
        {
          action: 'archive',
          commandId: randomUUID(),
          workspaceId: randomUUID(),
          expectedVersion: 0,
          confirmName: 'x',
        },
        'synthetic-someone-else',
        options.issuer,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(await counts()).toEqual(before);
  });
});

function h2subject(person: string) {
  return `synthetic-g45id-${person}`;
}

describe('closing, archiving and handing over a workspace need a recent sign-in', () => {
  test.each([
    ['twenty minutes ago', minutes(20)],
    ['not known', null],
    ['in the future', new Date(Date.now() + 3600000)],
  ])(
    'close with a sign-in %s is 403 with the plain words and writes nothing',
    async (_name, signedInAt) => {
      const before = await counts();
      await expect(
        accountService('kai', signedInAt).command({
          action: 'close',
          commandId: randomUUID(),
          confirmation: phrase,
        }),
      ).rejects.toMatchObject({
        ...refusal,
        message: recentSignInWords,
      });
      expect(await counts()).toEqual(before);
    },
  );

  test('close with a sign-in from fourteen minutes ago works', async () => {
    expect(
      await accountService('kai', minutes(14)).command({
        action: 'close',
        commandId: randomUUID(),
        confirmation: phrase,
      }),
    ).toMatchObject({ changed: true, status: 'closed' });
  });

  test('archive, offer and accept are refused with an old sign-in, and rename, restore, cancel and decline are not asked for one', async () => {
    const name = 'Synthetic liv workspace';
    const target = (await workspaceService('liv').state({})) as { workspaceId: string }[];
    const workspaceId = target[0]!.workspaceId;
    const memberId = await h.join('liv', 'mia', workspaceId);
    const before = await counts();
    const old = minutes(30);
    await expect(
      workspaceService('liv', old).command({
        action: 'archive',
        commandId: randomUUID(),
        workspaceId,
        expectedVersion: 0,
        confirmName: name,
      }),
    ).rejects.toMatchObject(refusal);
    await expect(
      workspaceService('liv', old).command({
        action: 'offer_transfer',
        commandId: randomUUID(),
        workspaceId,
        memberId,
        confirmName: name,
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject(refusal);
    await expect(
      workspaceService('mia', old).command({
        action: 'accept_transfer',
        commandId: randomUUID(),
        offerId: randomUUID(),
      }),
    ).rejects.toMatchObject(refusal);
    expect(await counts()).toEqual(before);
    // reversible or refusing commands do not ask
    expect(
      await workspaceService('liv', old).command({
        action: 'rename',
        commandId: randomUUID(),
        workspaceId,
        name: 'Synthetic liv renamed',
        reason: 'A clearer name for the team',
        expectedVersion: 0,
      }),
    ).toMatchObject({ operation: 'rename' });
    await expect(
      workspaceService('liv', old).command({
        action: 'cancel_transfer',
        commandId: randomUUID(),
        workspaceId,
        offerId: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 403, message: expect.not.stringContaining('sign in again') });
    // a recent sign-in does the same commands
    expect(
      await workspaceService('liv', minutes(2)).command({
        action: 'archive',
        commandId: randomUUID(),
        workspaceId,
        expectedVersion: 1,
        confirmName: 'Synthetic liv renamed',
      }),
    ).toMatchObject({ operation: 'archive' });
  });

  test('undo and a request for erasure do not ask for a recent sign-in', async () => {
    const old = minutes(60);
    expect(
      await accountService('kai', old).command({ action: 'file_erasure', commandId: randomUUID() }),
    ).toMatchObject({ changed: true });
    expect(
      await accountService('kai', old).command({ action: 'undo', commandId: randomUUID() }),
    ).toMatchObject({ status: 'active' });
  });

  test('the words on the screens equal the words of the server', () => {
    const screen = readFileSync(
      resolve('apps/web/app/account/workspace-lifecycle-client.ts'),
      'utf8',
    );
    expect(screen).toContain(`signInAgain: '${recentSignInWords}'`);
  });
});

// Every client that changes something under the lifecycle names the person the page was drawn for.
describe('the account screens send the identity', () => {
  const web = resolve('apps/web');
  const walk = (directory: string): string[] =>
    readdirSync(directory).flatMap((name) => {
      const path = join(directory, name);
      if (name === 'node_modules' || name === '.next') return [];
      return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
  const sources = [...walk(join(web, 'app/account')), ...walk(join(web, 'components'))].map(
    (path) => ({
      path: relative(web, path),
      text: readFileSync(path, 'utf8'),
    }),
  );
  const identity = /sessionHeaders|savedMissionHeaders|customerHeaders|x-corridra-customer-subject/;
  // Allowed exceptions, each with the reason.
  const exceptions: Record<string, string> = {
    'components/ux/notification-inbox.tsx':
      'the shared header has no page identity; it marks only the signed-in person own notifications as read',
    'app/account/delegations/programme-lifecycle.tsx':
      'the headers are passed in by the page that draws it, which is checked below',
  };

  test('every client with a state-changing request carries the identity, or is a listed exception', () => {
    const changing = sources.filter((file) => /method: '(POST|PUT|PATCH|DELETE)'/.test(file.text));
    expect(changing.length).toBeGreaterThan(10);
    const missing = changing.filter((file) => !identity.test(file.text)).map((file) => file.path);
    expect(missing.sort()).toEqual(Object.keys(exceptions).sort());
  });

  test('the programme lifecycle is drawn only by pages that pass the identity headers', () => {
    const users = sources.filter((file) => /from '.\/programme-lifecycle'/.test(file.text));
    expect(users.length).toBeGreaterThan(0);
    for (const file of users) expect(file.text, file.path).toMatch(/headers=\{headers\}/);
    for (const file of users)
      expect(file.text, file.path).toContain("'x-corridra-customer-subject': subject");
  });

  test('no lifecycle command or state read is sent without the identity', () => {
    for (const file of sources.filter(
      (source) => source.path !== 'app/account/account-lifecycle-client.ts',
    )) {
      expect(file.text, file.path).not.toMatch(/\bnoHeaders\b/);
      expect(file.text, file.path).not.toMatch(/useLifecycleCommand<[^>]*>\(\s*\{\s*\}/);
      for (const call of file.text.matchAll(/readAccountState\(([^)]*)\)/g))
        expect(call[1], file.path).toMatch(/^headers/);
    }
    const gate = sources.find((file) => file.path === 'components/customer-closed-account.tsx')!;
    expect(gate.text).toMatch(/subject: string;\s*issuer: string;/);
    const shell = sources.find((file) => file.path === 'components/customer-shell.tsx')!;
    expect(shell.text).toContain('IdentifiedClosedAccountGate');
  });

  test('the closing and erasure words make no claim the product does not keep', () => {
    for (const path of [
      'app/account/account-lifecycle-words.ts',
      'components/customer-closed-account.tsx',
    ]) {
      const text = sources.find((file) => file.path === path)!.text;
      expect(text, path).not.toMatch(/are hidden|Hide your account|separate reviewed step/);
    }
  });
});
