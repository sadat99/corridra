import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { DatabasePool } from '@corridra/db';
import { CustomerSessionBoundary } from './customer-session';
import { customerParticipantsEnabled } from './customer-participants';

// ADR-080. The public programme page and applications. Off unless the owner sets the switch to exactly 'true',
// and only where programme participants are on. Turning it on needs the installed database module.
export function customerProgrammePagesEnabled(env: NodeJS.ProcessEnv = process.env) {
  return customerParticipantsEnabled(env) && env.CORRIDRA_PROGRAMME_PAGES === 'true';
}

// One line of public text, as the database checks it: trimmed, no control character, counted in characters.
const line = (min: number, max: number) =>
  z
    .string()
    .trim()
    .refine((v) => [...v].length >= min && [...v].length <= max, `Use ${min} to ${max} characters`)
    .refine((v) => !/\p{Cc}/u.test(v), 'Use one line of plain text');

export const programmeActivity = z.strictObject({
  label: line(3, 160),
  status: z.enum(['PLANNED', 'CONFIRMED']),
});
// Exactly the fields that can be public. The database refuses anything else.
export const programmePublicCopy = z.strictObject({
  title: line(3, 160),
  organiser: line(2, 160),
  summary: line(10, 1200),
  destination: line(2, 160),
  dates: line(2, 160),
  focus: line(2, 300),
  audience: line(10, 600),
  eligibility: line(10, 600),
  activities: z.array(programmeActivity).max(12),
  included: z.array(line(2, 160)).max(8),
  excluded: z.array(line(2, 160)).max(8),
  fee: line(2, 300).optional(),
  capacity: z.number().int().min(1).max(1000).optional(),
});
export type ProgrammePublicCopy = z.infer<typeof programmePublicCopy>;

// The address a page keeps for good: a readable part and ten random characters.
export const programmeAddress = z
  .string()
  .min(12)
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*-[a-z0-9]{10}$/);
const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
// A readable address from the title. The random part is drawn without modulo bias (36 does not divide 256).
export function proposeProgrammeAddress(title: string) {
  const readable =
    title
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/g, '') || 'programme';
  let tail = '';
  while (tail.length < 10)
    for (const byte of randomBytes(16))
      if (byte < 252 && tail.length < 10) tail += alphabet[byte % 36];
  return `${readable}-${tail}`;
}

const scope = { workspaceId: z.uuid(), programmeId: z.uuid() };
const command = { commandId: z.uuid() };
export const programmePublicationInput = z.discriminatedUnion('action', [
  z.strictObject({
    ...command,
    ...scope,
    action: z.literal('publish'),
    expectedVersion: z.number().int().min(0).max(100000),
    copy: programmePublicCopy,
    closesAt: z.iso.datetime({ offset: true }),
    acknowledged: z.literal(true),
  }),
  z.strictObject({
    ...command,
    ...scope,
    action: z.literal('withdraw'),
    acknowledged: z.literal(true),
  }),
]);
export const programmeApplicationInput = z.discriminatedUnion('action', [
  z.strictObject({
    ...command,
    action: z.literal('apply'),
    address: programmeAddress,
    version: z.number().int().min(1).max(100000),
    displayLabel: line(2, 120),
    statement: line(10, 1000),
    consented: z.literal(true),
  }),
  z.strictObject({
    ...command,
    action: z.literal('withdraw'),
    applicationId: z.uuid(),
    acknowledged: z.literal(true),
  }),
  z.strictObject({
    ...command,
    action: z.literal('join'),
    applicationId: z.uuid(),
    consented: z.literal(true),
  }),
  z.strictObject({
    ...command,
    ...scope,
    action: z.literal('decide'),
    applicationId: z.uuid(),
    expectedVersion: z.number().int().min(0).max(100000),
    decision: z.enum(['INVITED', 'WAITLISTED', 'DECLINED']),
    note: line(10, 500).optional(),
    acknowledged: z.literal(true),
  }),
]);
const organiserPage = z.strictObject({
  ...scope,
  after: z.uuid().optional(),
  pageSize: z.coerce.number().int().min(1).max(25).default(25),
});
const ownPage = z.strictObject({
  after: z.uuid().optional(),
  pageSize: z.coerce.number().int().min(1).max(25).default(25),
});

// The refusals a screen tells apart from access loss. Each is a plain state the person can act on, never a fault.
export const programmePublicationRefusals = [
  'PROGRAMME_PUBLICATION_CHANGED',
  'PROGRAMME_PUBLICATION_ADDRESS_TAKEN',
  'PROGRAMME_PUBLICATION_PAUSED',
  'PROGRAMME_PUBLICATION_RATE_LIMITED',
  'PROGRAMME_APPLICATIONS_CLOSED',
  'PROGRAMME_ALREADY_REGISTERED',
  'PROGRAMME_APPLICATION_CHANGED',
  'PROGRAMME_APPLICATION_WITHDRAWN',
  'PROGRAMME_APPLICATION_JOINED',
  'PROGRAMME_APPLICATION_ALREADY_INVITED',
  'PROGRAMME_APPLICATION_NOT_INVITED',
  'PROGRAMME_INVITATION_EXPIRED',
  'PROGRAMME_APPLICATION_LIMIT',
  'PROGRAMME_APPLICATION_RATE_LIMITED',
] as const;
export type ProgrammePublicationRefusal = (typeof programmePublicationRefusals)[number];
export function programmePublicationRefusal(error: unknown): ProgrammePublicationRefusal | null {
  const message = (error as { message?: string } | null)?.message ?? '';
  return (programmePublicationRefusals as readonly string[]).includes(message)
    ? (message as ProgrammePublicationRefusal)
    : null;
}

export class CustomerProgrammePublicationService extends CustomerSessionBoundary {
  private one(sql: string, values: unknown[], subject?: string, issuer?: string) {
    return this.transaction(
      async (db) => (await db.query(sql, values)).rows[0].result,
      subject,
      issuer,
    );
  }
  async view(input: unknown, subject?: string, issuer?: string) {
    const v = z.strictObject(scope).parse(input);
    return this.one(
      'SELECT customer.programme_publication_view($1,$2) AS result',
      [v.workspaceId, v.programmeId],
      subject,
      issuer,
    );
  }
  // Publishing proposes an address only for the first version. If that address is taken (ten random characters, so
  // in practice never) it proposes another, a bounded number of times, inside the one request.
  async publication(input: unknown, subject?: string, issuer?: string) {
    const v = programmePublicationInput.parse(input);
    if (v.action === 'withdraw')
      return this.one(
        'SELECT customer.withdraw_programme_publication($1,$2,$3) AS result',
        [v.commandId, v.workspaceId, v.programmeId],
        subject,
        issuer,
      );
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.one(
          'SELECT customer.publish_programme($1,$2,$3,$4,$5,$6,$7) AS result',
          [
            v.commandId,
            v.workspaceId,
            v.programmeId,
            v.expectedVersion,
            proposeProgrammeAddress(v.copy.title),
            JSON.stringify(v.copy),
            v.closesAt,
          ],
          subject,
          issuer,
        );
      } catch (error) {
        if (
          programmePublicationRefusal(error) !== 'PROGRAMME_PUBLICATION_ADDRESS_TAKEN' ||
          attempt >= 3
        )
          throw error;
      }
    }
  }
  async application(input: unknown, subject?: string, issuer?: string) {
    const { commandId, action, ...rest } = programmeApplicationInput.parse(input);
    return this.one(
      'SELECT customer.programme_application_command($1,$2,$3) AS result',
      [commandId, action, JSON.stringify(rest)],
      subject,
      issuer,
    );
  }
  async applications(input: unknown, subject?: string, issuer?: string) {
    const v = organiserPage.parse(input);
    return this.one(
      'SELECT customer.programme_applications($1,$2,$3,$4) AS result',
      [v.workspaceId, v.programmeId, v.after ?? null, v.pageSize],
      subject,
      issuer,
    );
  }
  async own(input: unknown = {}, subject?: string, issuer?: string) {
    const v = ownPage.parse(input);
    return this.one(
      'SELECT customer.own_programme_applications($1,$2) AS result',
      [v.after ?? null, v.pageSize],
      subject,
      issuer,
    );
  }
}

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
const publicPage = z.strictObject({
  state: z.enum(['OPEN', 'CLOSED']),
  programme: programmePublicCopy,
  address: programmeAddress,
  version: z.number().int().min(1),
  closesAt: iso,
  publishedAt: iso,
  sample: z.boolean(),
});
export type PublicProgrammePage = z.infer<typeof publicPage>;
const unknown = { state: 'unknown' } as const;
// The anonymous read. A plain statement on the runtime pool; it writes nothing. Every answer that is not a readable
// page, including a module that is not installed and a malformed address, is the same single value.
export class ProgrammePageReader {
  constructor(private readonly pool: DatabasePool) {}
  async read(address: string | null): Promise<PublicProgrammePage | typeof unknown> {
    if (address === null || !programmeAddress.safeParse(address).success) return unknown;
    try {
      const result = await this.pool.query('SELECT app.read_programme_publication($1) AS result', [
        address,
      ]);
      const page = publicPage.safeParse(result.rows[0]?.result);
      return page.success ? page.data : unknown;
    } catch (error) {
      if (['42883', '42P01', '3F000'].includes((error as { code?: string }).code ?? ''))
        return unknown;
      throw error;
    }
  }
}
