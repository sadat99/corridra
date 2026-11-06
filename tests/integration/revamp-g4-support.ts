import { randomUUID } from 'node:crypto';
import type { DatabaseClient } from '../../packages/db/src/index';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';
import { CustomerSessionBoundary } from '../../packages/auth/src/customer-session';
import { CustomerWorkspaceService } from '../../packages/auth/src/customer-workspaces';
import type { fixture } from './support';

// Shared setup for the CRUD G4 (workspace lifecycle) integration tests: invented synthetic customers on the real
// restricted SQL logins. Nothing here is a real account or email.
export const issuer = 'https://ep-g4-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
export const options = { enabled: true, synthetic: true, production: false, issuer };
export type Fixture = Awaited<ReturnType<typeof fixture>>;
export type Row = Record<string, unknown>;

class Probe extends CustomerSessionBoundary {
  run<T>(work: (db: DatabaseClient) => Promise<T>) {
    return this.transaction(async (db) => work(db));
  }
}

export function harness(f: Fixture, prefix: string) {
  const session = (person: string) => ({
    subject: `synthetic-${prefix}-${person}`,
    emailVerified: true,
    expiresAt: new Date(Date.now() + 3600000),
  });
  const workspaces = (person = 'alice') =>
    new CustomerWorkspaceService(f.runtime, f.auth, options, async () => session(person));
  const as = <T>(person: string, work: (db: DatabaseClient) => Promise<T>) =>
    new Probe(f.runtime, f.auth, options, async () => session(person)).run(work);
  const sql = <T extends Row = Row>(person: string, text: string, params: unknown[] = []) =>
    as(person, async (db) => (await db.query<T>(text, params)).rows[0]!);
  const lifecycle = (
    person: string,
    operation: string,
    input: Record<string, unknown>,
    command = randomUUID(),
  ) =>
    sql<{ r: Record<string, unknown> }>(
      person,
      'SELECT customer.workspace_lifecycle_command($1,$2,$3) AS r',
      [command, operation, JSON.stringify(input)],
    ).then((row) => row.r);
  const ownership = (
    person: string,
    operation: string,
    input: Record<string, unknown>,
    command = randomUUID(),
  ) =>
    sql<{ r: Record<string, unknown> }>(
      person,
      'SELECT customer.workspace_ownership_command($1,$2,$3) AS r',
      [command, operation, JSON.stringify(input)],
    ).then((row) => row.r);
  const state = (person: string, target?: string) =>
    sql<{ r: Record<string, unknown> | Record<string, unknown>[] }>(
      person,
      'SELECT customer.workspace_lifecycle_state($1) AS r',
      [target ?? null],
    ).then((row) => row.r);
  const setControl = async (enabled: boolean) => {
    const latest = (
      await f.owner.query(
        'SELECT coalesce(max(version),0)::int AS v FROM customer_private.workspace_lifecycle_control',
      )
    ).rows[0].v as number;
    await f.owner.query(
      'INSERT INTO customer_private.workspace_lifecycle_control(version,enabled,executor_id,reason) VALUES($1,$2,$3,$4)',
      [latest + 1, enabled, f.serviceId, 'Fixture control for the workspace lifecycle tests'],
    );
  };
  const admit = async (people: string[]) => {
    for (const person of people)
      await admitSyntheticCustomer(f.owner, {
        issuer,
        subject: session(person).subject,
        executorId: f.serviceId,
        reason: 'Explicit fictional workspace lifecycle fixture, no real account or email',
      });
  };
  const provision = async (person: string, name: string) =>
    (await workspaces(person).provision({ commandId: randomUUID(), name })).id;
  // An invited member: returns the workspace_member id the owner can hand ownership to.
  const join = async (owner: string, person: string, target: string) => {
    const invited = await workspaces(owner).access({
      action: 'invite',
      commandId: randomUUID(),
      workspaceId: target,
      label: `Synthetic invited ${person}`,
    });
    const accepted = await workspaces(person).access({
      action: 'accept',
      commandId: randomUUID(),
      token: invited.token!,
    });
    return accepted.memberId!;
  };
  // An admin by a direct membership row, as the programme lifecycle tests do.
  const makeAdmin = (person: string, target: string) =>
    f.owner.query(
      "INSERT INTO customer.membership(tenant_id,principal_id,role) SELECT $1,id,'admin' FROM customer_private.principal WHERE issuer=$2 AND subject=$3",
      [target, issuer, session(person).subject],
    );
  const lifecycleCounts = async () =>
    (
      await f.owner.query(`SELECT
 (SELECT count(*)::int FROM customer_private.workspace_revision) revisions,
 (SELECT count(*)::int FROM customer_private.workspace_lifecycle_request) requests,
 (SELECT count(*)::int FROM customer_private.workspace_transfer_offer) offers,
 (SELECT count(*)::int FROM customer_private.workspace_transfer_outcome) outcomes,
 (SELECT count(*)::int FROM customer_private.workspace_ownership_history) history,
 (SELECT count(*)::int FROM customer.membership) memberships,
 (SELECT count(*)::int FROM app.domain_event WHERE aggregate_type='customer_workspace_access') events,
 (SELECT count(*)::int FROM app.audit_event a JOIN app.domain_event e ON e.id=a.domain_event_id WHERE e.aggregate_type='customer_workspace_access') audits,
 (SELECT count(*)::int FROM app.outbox o JOIN app.domain_event e ON e.id=o.event_id WHERE e.aggregate_type='customer_workspace_access') outbox,
 (SELECT count(*)::int FROM app.outbox_delivery d JOIN app.domain_event e ON e.id=d.event_id WHERE e.aggregate_type='customer_workspace_access') deliveries`)
    ).rows[0] as Record<string, number>;
  return {
    session,
    workspaces,
    as,
    sql,
    lifecycle,
    ownership,
    state,
    setControl,
    admit,
    provision,
    join,
    makeAdmin,
    lifecycleCounts,
  };
}

// md5 over every row of the named tables, so a test can prove that nothing existing was rewritten.
export async function digest(f: Fixture, tables: string[]) {
  const result: Record<string, string> = {};
  for (const table of tables)
    result[table] = (
      await f.owner.query(
        `SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'')) AS d FROM ${table} t`,
      )
    ).rows[0].d as string;
  return result;
}
