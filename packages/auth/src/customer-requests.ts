import { customerDataEnvironmentAllowed } from './customer-production';
import { z } from 'zod';
import { customerProductionLocked } from './customer-production';
import { briefSchema, realBriefSchema } from '@corridra/domain/missions';
import { DomainError } from '@corridra/domain';
import type { DatabaseClient, DatabasePool } from '@corridra/db';
import {
  CustomerSessionBoundary,
  type CustomerSession,
  type CustomerWorkspaceOptions,
} from './customer-session';
import type { MissionMailJob, MissionMailPort } from './mission-mail';

export const customerRequestInput = z
  .object({
    commandId: z.uuid(),
    workspaceId: z.uuid(),
    brief: briefSchema,
  })
  .strict();
const pageInput = z
  .object({
    after: z.uuid().optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type CustomerRequestContext = {
  issuer: string;
  subject: string;
  workspaceId: string;
  commandId: string;
  synthetic?: boolean;
};
export type CustomerRequestPlan = {
  key: string;
  payloadHash: string;
  receiptHash: string;
  noticeVersion: string;
};
export function customerRequestsEnabled(env: NodeJS.ProcessEnv = process.env) {
  return (
    env.CORRIDRA_CUSTOMER_REQUESTS_ENABLED === 'true' &&
    customerDataEnvironmentAllowed(env) &&
    !customerProductionLocked(env)
  );
}

// Trusted server composition supplies canonical preparation. No browser key,
// receipt, issuer or subject can become positive authority.
export class CustomerRequestService extends CustomerSessionBoundary {
  // The optional mail port exists only while the mission mail switch is on. Without it nothing below
  // runs and a request is stored exactly as before.
  constructor(
    runtime: DatabasePool,
    auth: DatabasePool,
    options: CustomerWorkspaceOptions,
    readSession: () => Promise<CustomerSession | null>,
    private mail?: MissionMailPort,
  ) {
    super(runtime, auth, options, readSession);
  }

  private async dispatchMail(jobs: MissionMailJob[]) {
    for (const job of jobs)
      try {
        await this.mail?.dispatch(job);
      } catch {
        console.info(JSON.stringify({ event: 'mission_mail_dispatch_failed' }));
      }
  }

  async list(input: unknown = {}, expectedSubject?: string, expectedIssuer?: string) {
    const page = pageInput.parse(input);
    return this.transaction(
      async (db) => {
        const result = await db.query('SELECT customer.private_requests($1,$2) AS result', [
          page.after ?? null,
          page.pageSize,
        ]);
        return result.rows[0].result;
      },
      expectedSubject,
      expectedIssuer,
    );
  }

  async submit(
    input: unknown,
    prepare: (context: CustomerRequestContext, brief: unknown) => CustomerRequestPlan,
    expectedSubject?: string,
    expectedIssuer?: string,
  ) {
    const value = (
      this.options.dataMode === 'real'
        ? customerRequestInput.extend({ brief: realBriefSchema })
        : customerRequestInput
    ).parse(input);
    const jobs: MissionMailJob[] = [];
    const result = await this.transaction(
      async (db, proof) => {
        return this.submitInTransaction(db, proof, value, prepare, jobs);
      },
      expectedSubject,
      expectedIssuer,
    );
    await this.dispatchMail(jobs);
    return result;
  }

  private async submitInTransaction(
    db: DatabaseClient,
    proof: { hash: string; issuer: string; subject: string; email?: string },
    value: { commandId: string; workspaceId: string; brief: unknown },
    prepare: (context: CustomerRequestContext, brief: unknown) => CustomerRequestPlan,
    jobs?: MissionMailJob[],
  ) {
    const synthetic =
      this.options.dataMode === 'real'
        ? (await db.query('SELECT customer.workspace_mode($1) synthetic', [value.workspaceId]))
            .rows[0].synthetic
        : true;
    const brief = (synthetic ? briefSchema : realBriefSchema).parse(value.brief);
    const body = JSON.stringify(brief);
    const retry = await db.query('SELECT customer.request_retry($1,$2,$3::jsonb) AS result', [
      value.commandId,
      value.workspaceId,
      body,
    ]);
    if (retry.rows[0].result) return retry.rows[0].result;
    const plan = prepare(
      {
        issuer: proof.issuer,
        subject: proof.subject,
        workspaceId: value.workspaceId,
        commandId: value.commandId,
        synthetic,
      },
      brief,
    );
    await this.auth.query(
      'SELECT customer_private.attest_request($1,$2,$3,$4::jsonb,$5,$6,$7,$8)',
      [
        proof.hash,
        value.commandId,
        value.workspaceId,
        body,
        plan.key,
        plan.payloadHash,
        plan.receiptHash,
        plan.noticeVersion,
      ],
    );
    const result = await db.query(
      'SELECT customer.submit_private_request($1,$2,$3::jsonb) AS result',
      [value.commandId, value.workspaceId, body],
    );
    const stored = result.rows[0].result;
    // Inside the same transaction, in a savepoint: a mail problem never fails or undoes the request.
    if (this.mail && jobs && proof.email && stored?.id) {
      const job = await this.mail.enqueue(db, {
        requestId: stored.id,
        email: proof.email,
        name: (brief as { name: string }).name,
        objective: (brief as { objective: string }).objective,
      });
      if (job) jobs.push(job);
    }
    return stored;
  }

  async claimPending(
    capability: { id: string; hash: string },
    prepare: (context: CustomerRequestContext, brief: unknown) => CustomerRequestPlan,
  ) {
    if (this.options.dataMode !== 'real') throw new DomainError('Real intake is unavailable', 503);
    const cap = z
      .object({ id: z.uuid(), hash: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .parse(capability);
    // The existing auth attestation has a workspace FK on its separate connection.
    // Commit personal workspace provisioning first; canonical submission and ownership
    // consumption remain atomic in the second freshly verified transaction.
    const scope = await this.transaction(async (db, proof) => {
      const pending = (
        await db.query('SELECT customer.pending_request_for_claim($1,$2) result', [
          cap.id,
          cap.hash,
        ])
      ).rows[0].result;
      let workspaceId: string | null = null;
      if (!pending.requestId) {
        const brief = realBriefSchema.parse(pending.brief);
        workspaceId = (
          await db.query('SELECT customer.personal_workspace($1,$2) id', [
            cap.id,
            brief.company.slice(0, 100) + ' workspace',
          ])
        ).rows[0].id;
      }
      return { workspaceId, subject: proof.subject, issuer: proof.issuer };
    });
    const jobs: MissionMailJob[] = [];
    const claimed = await this.transaction(
      async (db, proof) => {
        const pending = (
          await db.query('SELECT customer.pending_request_for_claim($1,$2) result', [
            cap.id,
            cap.hash,
          ])
        ).rows[0].result;
        let requestId = pending.requestId as string | null;
        if (!requestId) {
          if (!scope.workspaceId) throw new DomainError('Request workspace is unavailable', 409);
          const brief = realBriefSchema.parse(pending.brief);
          const request = await this.submitInTransaction(
            db,
            proof,
            { commandId: cap.id, workspaceId: scope.workspaceId, brief },
            prepare,
            jobs,
          );
          requestId = request.id;
        }
        return (
          await db.query('SELECT customer.complete_pending_request($1,$2,$3) result', [
            cap.id,
            cap.hash,
            requestId,
          ])
        ).rows[0].result;
      },
      scope.subject,
      scope.issuer,
    );
    await this.dispatchMail(jobs);
    return claimed;
  }
}
