import { beforeAll, afterAll, test, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from './support';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateCustomerProgrammeLifecycle } from '../../packages/db/src/customer-programme-lifecycle-migrate';
import { migrateCustomerParticipantLabels } from '../../packages/db/src/customer-participant-label-migrate';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import { CustomerProgrammeService } from '../../packages/auth/src/customer-programmes';
import { CustomerParticipantService } from '../../packages/auth/src/customer-participants';
import { CustomerSessionBoundary } from '../../packages/auth/src/customer-session';
import type { DatabaseClient } from '../../packages/db/src/index';

// CRUD gap G7, module 2: a participant's display label can be corrected, by them or by a workspace owner or admin, as an
// append-only versioned overlay. The registration row and the consent are never changed.
const issuer =
  'https://ep-participant-label-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
let f: Awaited<ReturnType<typeof fixture>>;
let workspaceId: string;
let programmeId: string;
let registrationId: string;
let otherRegistration: string;
const original = 'Synthetic participant Bob';
const session = (person = 'alice') => ({
  subject: 'synthetic-label-' + person,
  emailVerified: true,
  expiresAt: new Date(Date.now() + 3600000),
});
const workspaces = (person = 'alice') =>
  new CustomerWorkspaceService(f.runtime, f.auth, options, async () => session(person));
const programmes = (person = 'alice') =>
  new CustomerProgrammeService(f.runtime, f.auth, options, async () => session(person));
const people = (person = 'alice') =>
  new CustomerParticipantService(f.runtime, f.auth, options, async () => session(person));
const relabel = (
  registration: string,
  expectedVersion: number,
  displayLabel: string,
  commandId = randomUUID(),
) => ({
  action: 'label' as const,
  commandId,
  workspaceId,
  programmeId,
  registrationId: registration,
  expectedVersion,
  displayLabel,
});
async function register(person: string, label: string) {
  const invitation = await people().command({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId,
    programmeId,
    label: 'Synthetic participant invitation',
    acknowledged: true,
  });
  await people(person).command({
    action: 'accept',
    commandId: randomUUID(),
    token: invitation.token,
    programmeId,
    displayLabel: label,
    consented: true,
  });
  const own = await people(person).own({});
  return own.registrations.find((r: { programmeId: string }) => r.programmeId === programmeId)
    .id as string;
}
const shown = async () => {
  const list = await people().list({ workspaceId, programmeId });
  return Object.fromEntries(
    list.registrations.map((r: { id: string; displayLabel: string }) => [r.id, r.displayLabel]),
  );
};
let baseDigest = '';
const digest = async () =>
  (
    await f.owner.query(
      "SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id)::text,'')) AS d FROM customer_private.programme_registration r",
    )
  ).rows[0].d as string;

beforeAll(async () => {
  f = await fixture();
  await migrateCustomerRealUse(f.owner);
  await expect(migrateCustomerParticipantLabels(f.owner)).rejects.toThrow('Install the real-use');
  await migrateCustomerProgrammeLifecycle(f.owner);
  for (const person of ['alice', 'bob', 'carol', 'member', 'admin', 'outsider'])
    await admitSyntheticCustomer(f.owner, {
      issuer,
      subject: session(person).subject,
      executorId: f.serviceId,
      reason: 'Explicit fictional participant label authority fixture,no real customer account',
    });
  workspaceId = (
    await workspaces().provision({ commandId: randomUUID(), name: 'Synthetic label workspace' })
  ).id;
  const invitation = await workspaces().access({
    action: 'invite',
    commandId: randomUUID(),
    workspaceId,
    label: 'Synthetic existing colleague',
  });
  await workspaces('member').access({
    action: 'accept',
    commandId: randomUUID(),
    token: invitation.token,
  });
  await f.owner.query(
    "INSERT INTO customer.membership(tenant_id,principal_id,role) SELECT $1,id,'admin' FROM customer_private.principal WHERE issuer=$2 AND subject=$3",
    [workspaceId, issuer, session('admin').subject],
  );
  programmeId = (
    await programmes().create({
      commandId: randomUUID(),
      workspaceId,
      name: 'Synthetic label programme',
      reportingPurpose: 'Synthetic label correction fixture programme',
      acknowledged: true,
    })
  ).id;
  registrationId = await register('bob', original);
  otherRegistration = await register('carol', 'Synthetic participant Carol');
  baseDigest = await digest();
  await migrateCustomerParticipantLabels(f.owner);
});
afterAll(async () => {
  await f?.close();
});

test('installs once, repeats safely, refuses a changed history, and leaves every registration row as it was', async () => {
  await migrateCustomerParticipantLabels(f.owner);
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM customer_participant_label_migrations.applied',
      )
    ).rows[0].n,
  ).toBe(1);
  expect(await digest()).toBe(baseDigest);
  await f.owner.query("UPDATE customer_participant_label_migrations.applied SET sha256='0'");
  await expect(migrateCustomerParticipantLabels(f.owner)).rejects.toThrow('history mismatch');
});

test('with no correction every reader shows the label given on accepting', async () => {
  expect(await shown()).toMatchObject({ [registrationId]: original });
  const own = await people('bob').own({});
  expect(own.registrations.find((r: { id: string }) => r.id === registrationId).displayLabel).toBe(
    original,
  );
});

test('every reader of the label reads the current view, none reads the registration table', async () => {
  const defs = (
    await f.owner.query(
      "SELECT p.oid::regprocedure::text sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('app','customer','customer_private') AND p.prokind='f' AND pg_get_functiondef(p.oid) ~ 'programme_registration_current'",
    )
  ).rows
    .map((r) => r.sig)
    .sort();
  expect(defs).toEqual(
    [
      'customer.own_programme_registrations(uuid,integer)',
      'customer.programme_economics(uuid,uuid)',
      'customer.programme_participants(uuid,uuid,uuid,uuid,integer)',
      'customer.programme_places_report(uuid,uuid)',
      'customer.programme_pricing_overview(uuid,uuid)',
      'customer.programme_registration_label(uuid,uuid,uuid,uuid,integer,text)',
      'customer.programme_report(uuid,uuid)',
      'customer_private.programme_ledger_entry_json(uuid)',
    ].sort(),
  );
  const direct = (
    await f.owner.query(
      "SELECT p.oid::regprocedure::text sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('app','customer','customer_private') AND p.prokind='f' AND pg_get_functiondef(p.oid) ~ 'display_label' AND pg_get_functiondef(p.oid) ~ '(FROM|JOIN) customer_private\\.programme_registration([^_a-z]|$)'",
    )
  ).rows
    .map((r) => r.sig)
    .sort();
  // The accept path still writes the registration, and the correction function finds the registration it changes.
  expect(direct).toEqual([
    'customer.programme_participant_command(uuid,text,jsonb)',
    'customer.programme_registration_label(uuid,uuid,uuid,uuid,integer,text)',
  ]);
});

test('the participant corrects their own label; the organiser list and the participant see it, the stored row is unchanged', async () => {
  const done = await people('bob').command(
    relabel(registrationId, 0, 'Synthetic participant Bob Rahman'),
  );
  expect(done).toMatchObject({
    displayLabel: 'Synthetic participant Bob Rahman',
    labelVersion: 1,
    changedBy: 'participant',
    replayed: false,
  });
  expect((await shown())[registrationId]).toBe('Synthetic participant Bob Rahman');
  const own = await people('bob').own({});
  expect(own.registrations.find((r: { id: string }) => r.id === registrationId).displayLabel).toBe(
    'Synthetic participant Bob Rahman',
  );
  const stored = (
    await f.owner.query(
      'SELECT display_label,consented_at FROM customer_private.programme_registration WHERE id=$1',
      [registrationId],
    )
  ).rows[0];
  expect(stored.display_label).toBe(original);
  expect(await digest()).toBe(baseDigest);
});

test('an owner or admin may correct a label; a member, an outsider and another participant may not', async () => {
  const byOwner = await people().command(relabel(registrationId, 1, 'Synthetic participant Bob R'));
  expect(byOwner).toMatchObject({ labelVersion: 2, changedBy: 'organiser' });
  const byAdmin = await people('admin').command(
    relabel(registrationId, 2, 'Synthetic participant Bob Rahman'),
  );
  expect(byAdmin).toMatchObject({ labelVersion: 3, changedBy: 'organiser' });
  for (const person of ['member', 'outsider', 'carol'])
    await expect(
      people(person).command(relabel(registrationId, 3, 'Synthetic participant not allowed')),
    ).rejects.toMatchObject({ code: '42501' });
  expect((await shown())[registrationId]).toBe('Synthetic participant Bob Rahman');
  await expect(
    people('bob').command(relabel(otherRegistration, 0, 'Synthetic participant hijacked')),
  ).rejects.toMatchObject({ code: '42501' });
});

test('a stale version is refused and a no-op is refused', async () => {
  await expect(
    people('bob').command(relabel(registrationId, 1, 'Synthetic participant stale try')),
  ).rejects.toMatchObject({ code: '23514', message: 'Label changed; reload before saving' });
  await expect(
    people('bob').command(relabel(registrationId, 3, 'Synthetic participant Bob Rahman')),
  ).rejects.toMatchObject({ code: '23514', message: 'Nothing changed' });
});

test('a retry with the same command id answers once; a different label under it conflicts', async () => {
  const input = relabel(otherRegistration, 0, 'Synthetic participant Carol Das');
  const [a, b] = await Promise.all([
    people('carol').command(input),
    people('carol').command(input),
  ]);
  expect([a.labelVersion, b.labelVersion]).toEqual([1, 1]);
  expect([a.replayed, b.replayed].filter(Boolean)).toHaveLength(1);
  await expect(
    people('carol').command({ ...input, displayLabel: 'Synthetic participant another name' }),
  ).rejects.toMatchObject({ code: '23514' });
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int n FROM customer_private.programme_registration_label_revision WHERE registration_id=$1',
        [otherRegistration],
      )
    ).rows[0].n,
  ).toBe(1);
});

test('the label must be well formed (too short, too long, and padded at the database)', async () => {
  for (const bad of ['Synthetic', 'x'.repeat(130)])
    await expect(people('bob').command(relabel(registrationId, 3, bad))).rejects.toThrow();
  class Probe extends CustomerSessionBoundary {
    run<T>(fn: (db: DatabaseClient) => Promise<T>) {
      return this.transaction(async (db) => fn(db));
    }
  }
  const probe = new Probe(f.runtime, f.auth, options, async () => session('bob'));
  await expect(
    probe.run((db) =>
      db.query('SELECT customer.programme_registration_label($1,$2,$3,$4,$5,$6)', [
        randomUUID(),
        workspaceId,
        programmeId,
        registrationId,
        3,
        ' Synthetic padded label here ',
      ]),
    ),
  ).rejects.toMatchObject({ code: '23514' });
  expect((await shown())[registrationId]).toBe('Synthetic participant Bob Rahman');
});

test('the audit event keeps the old and new label and who changed it, and nothing else about the person', async () => {
  const events = (
    await f.owner.query(
      "SELECT payload FROM app.domain_event WHERE tenant_id=$1 AND aggregate_type='customer_programme_registration' AND aggregate_id=$2 ORDER BY aggregate_version",
      [workspaceId, registrationId],
    )
  ).rows.map((r) => r.payload);
  expect(events.map((e) => e.changedBy)).toEqual(['participant', 'organiser', 'organiser']);
  expect(events[0].before).toEqual({ displayLabel: original });
  expect(events[0].after).toEqual({ displayLabel: 'Synthetic participant Bob Rahman' });
  for (const e of events)
    expect(JSON.stringify(e)).not.toMatch(/email|token|consent|principal_id/i);
});

test('consent is untouched, a withdrawn participant cannot be relabelled, and rows cannot be rewritten', async () => {
  const before = (
    await f.owner.query(
      'SELECT consented_at FROM customer_private.programme_registration WHERE id=$1',
      [otherRegistration],
    )
  ).rows[0].consented_at;
  await people('carol').command({
    action: 'withdraw',
    commandId: randomUUID(),
    registrationId: otherRegistration,
    reason: 'Synthetic participant leaves the programme',
    acknowledged: true,
  });
  await expect(
    people('carol').command(relabel(otherRegistration, 1, 'Synthetic participant after leaving')),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    people().command(relabel(otherRegistration, 1, 'Synthetic organiser after leaving')),
  ).rejects.toMatchObject({ code: '42501' });
  expect(
    (
      await f.owner.query(
        'SELECT consented_at FROM customer_private.programme_registration WHERE id=$1',
        [otherRegistration],
      )
    ).rows[0].consented_at,
  ).toEqual(before);
  await expect(
    f.owner.query(
      'UPDATE customer_private.programme_registration_label_revision SET display_label=display_label',
    ),
  ).rejects.toThrow();
  await expect(
    f.owner.query('DELETE FROM customer_private.programme_registration_label_revision'),
  ).rejects.toThrow();
  await expect(
    f.runtime.query('SELECT * FROM customer_private.programme_registration_current'),
  ).rejects.toMatchObject({ code: '42501' });
});
