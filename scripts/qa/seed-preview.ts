import { randomBytes } from 'node:crypto';
import type { DatabasePool } from '../../packages/db/src/index';
import { seedSyntheticWorkspace } from '../../packages/auth/src/bootstrap';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';

// Seed for the commercial readiness verification suite (program W0.5). Preview and local only.
// It refuses to run against anything that looks like production: a host that is not local, a
// DATA_ENVIRONMENT of "real", or a Vercel production environment. Every record it writes is marked
// "QA test (madeup)" or uses an @example.invalid address.
//
// Accounts: OWNER (team owner with an authenticator), plus whatever each stream's seed adds through
// tests/e2e/verification/<stream>/seed.ts. Customer accounts use the external customer sign-in
// service, so customer journeys are proved with the repository's fixture pages, not live accounts.

export type QaSeed = {
  tenantId: string;
  principalId: string;
  owner: { email: string; password: string };
  streams: Record<string, unknown>;
};

export function assertNotProduction(connectionHost: string, env: NodeJS.ProcessEnv = process.env) {
  const local = ['127.0.0.1', 'localhost', '::1'].includes(connectionHost);
  if (!local) throw new Error('QA seed refuses a non-local database host.');
  if (env.DATA_ENVIRONMENT === 'real' || env.VERCEL_ENV === 'production')
    throw new Error('QA seed refuses a production environment.');
}

export async function seedPreview(
  db: DatabasePool,
  connectionHost: string,
  streamSeeds: Record<
    string,
    (db: DatabasePool, base: Omit<QaSeed, 'streams'>) => Promise<unknown>
  >,
): Promise<QaSeed> {
  assertNotProduction(connectionHost);
  const password = randomBytes(24).toString('base64url');
  const owner = { email: 'qa-owner@example.invalid', password };
  const seed = await seedSyntheticWorkspace(db, { ...owner, name: 'QA test (madeup) Owner' });
  await configureSyntheticIntake(db, seed.tenantId, seed.principalId);
  const base = { tenantId: seed.tenantId, principalId: seed.principalId, owner };
  const streams: Record<string, unknown> = {};
  for (const [name, run] of Object.entries(streamSeeds)) streams[name] = await run(db, base);
  return { ...base, streams };
}
