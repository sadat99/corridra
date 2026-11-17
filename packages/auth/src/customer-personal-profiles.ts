import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CustomerSessionBoundary } from './customer-session';

// ADR-086: the signed-in person's own optional, self-reported details. Server-only. The database decides who the person is
// (customer.actor_id() from the fresh provider session); nothing here takes a person id from the browser.
const control = /[\u0000-\u001f\u007f]/u;
export const personalContactMethods = ['EMAIL', 'IN_APP', 'NO_PREFERENCE'] as const;
export const personalInitialsPreferences = ['NAME_INITIALS', 'EMAIL_INITIALS', 'NONE'] as const;
export const personalInterestLimit = 10;
export const customerPersonalProfileDetails = z
  .object({
    title: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .refine((v) => !control.test(v), 'Control characters are not allowed')
      .nullable()
      .optional(),
    baseCountry: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable()
      .optional(),
    interests: z
      .array(
        z
          .string()
          .trim()
          .min(2)
          .max(60)
          .refine((v) => !control.test(v), 'Control characters are not allowed'),
      )
      .max(personalInterestLimit)
      .refine(
        (words) => new Set(words.map((w) => w.toLowerCase())).size === words.length,
        'Interests must be unique',
      )
      .optional(),
    contactMethod: z.enum(personalContactMethods).optional(),
    initialsPreference: z.enum(personalInitialsPreferences).optional(),
  })
  .strict();
export const customerPersonalProfileInput = customerPersonalProfileDetails
  .extend({
    commandId: z.uuid(),
    expectedVersion: z.number().int().min(0).max(2147483646),
  })
  .strict();
export const customerPersonalProfileHistoryQuery = z
  .object({
    beforeVersion: z.coerce.number().int().min(1).max(2147483646).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export const accountSecurityKinds = [
  'name_changed',
  'password_changed',
  'session_revoked',
  'other_sessions_revoked',
] as const;
export type AccountSecurityKind = (typeof accountSecurityKinds)[number];
export type CustomerPersonalProfileDetails = z.infer<typeof customerPersonalProfileDetails>;
export type CustomerPersonalProfileView = {
  currentVersion: number;
  provenance: 'SELF_REPORTED';
  verified: false;
  profile: (CustomerPersonalProfileDetails & { version: number; updatedAt: string }) | null;
};
export type CustomerPersonalProfileCommandResult = {
  commandId: string;
  currentVersion: number;
  superseded: boolean;
  profile: (CustomerPersonalProfileDetails & { version: number; updatedAt: string }) | null;
};
export type CustomerPersonalProfileHistory = {
  revisions: { version: number; createdAt: string; provenance: 'SELF_REPORTED' }[];
  nextBefore: number | null;
};
// The words a refusal from the database maps to on the screens. The database text is matched exactly.
export const personalProfileStaleMessage = 'Profile changed; reload before saving';
export const personalProfileNoWorkspaceMessage =
  'Personal details need a workspace on this account. Create or join a workspace first.';
// The per-person budget key for a name change: no name, no email, only the issuer and subject, hashed.
export function accountNameBudgetKey(issuer: string, subject: string) {
  return createHash('sha256')
    .update('account:name:' + issuer + ':' + subject)
    .digest('hex');
}

export class CustomerPersonalProfileService extends CustomerSessionBoundary {
  async view(subject?: string, issuer?: string) {
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: CustomerPersonalProfileView }>(
            'SELECT customer.personal_profile_view() AS result',
          )
        ).rows[0]!.result,
      subject,
      issuer,
    );
  }
  async command(input: unknown, subject?: string, issuer?: string) {
    const { commandId, expectedVersion, ...details } = customerPersonalProfileInput.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: CustomerPersonalProfileCommandResult }>(
            'SELECT customer.personal_profile_command($1,$2,$3) AS result',
            [commandId, expectedVersion, JSON.stringify(details)],
          )
        ).rows[0]!.result,
      subject,
      issuer,
    );
  }
  async history(input: unknown, subject?: string, issuer?: string) {
    const { beforeVersion, pageSize } = customerPersonalProfileHistoryQuery.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: CustomerPersonalProfileHistory }>(
            'SELECT customer.personal_profile_history($1,$2) AS result',
            [beforeVersion ?? null, pageSize],
          )
        ).rows[0]!.result,
      subject,
      issuer,
    );
  }
  // Before a name change reaches the provider: the account refusals (closed, erasure filed: 42501), then the hourly budget
  // of six, then whether this command was already recorded (a lost response). The budget is counted even on a replay.
  async nameChangePreflight(commandId: string, subject?: string, issuer?: string) {
    const command = z.uuid().parse(commandId);
    return this.transaction(
      async (db, proof) => {
        const noted = (
          await db.query<{ noted: boolean }>(
            'SELECT customer.account_security_noted($1) AS noted',
            [command],
          )
        ).rows[0]!.noted;
        const ok = (
          await db.query<{ ok: boolean }>('SELECT app.intake_budget($1,6) AS ok', [
            accountNameBudgetKey(proof.issuer, proof.subject),
          ])
        ).rows[0]!.ok;
        return { limited: !ok, noted };
      },
      subject,
      issuer,
    );
  }
  async noteSecurityChange(
    commandId: string,
    kind: AccountSecurityKind,
    subject?: string,
    issuer?: string,
  ) {
    const command = z.uuid().parse(commandId);
    const k = z.enum(accountSecurityKinds).parse(kind);
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: { commandId: string; kind: string; replayed: boolean } }>(
            'SELECT customer.account_security_note($1,$2) AS result',
            [command, k],
          )
        ).rows[0]!.result,
      subject,
      issuer,
    );
  }
}
