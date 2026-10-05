import { z } from 'zod';
const databaseUrl = z.url().refine((value) => {
  const u = new URL(value);
  return u.protocol === 'postgresql:' || u.protocol === 'postgres:';
}, 'PostgreSQL URL required');
export function readFoundationConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.CORRIDRA_FOUNDATIONS_ENABLED !== 'true') return null;
  if (env.VERCEL_ENV === 'production' && env.CORRIDRA_LIVE_ROLLOUT_ENABLED !== 'true')
    throw new Error('Explicit live rollout authorization is required in production');
  const c = z
    .object({
      APP_ORIGIN: z.url(),
      RUNTIME_DATABASE_URL: databaseUrl,
      AUTH_DATABASE_URL: databaseUrl,
      AUTH_SECRET: z.string().min(32),
      DATA_ENVIRONMENT: z.literal('synthetic'),
      EVIDENCE_SCAN_MODE: z.enum(['required', 'bypass']).default('required'),
      DATABASE_REGION: z.enum(['aws-eu-central-1', 'aws-eu-west-1', 'aws-eu-west-3', 'local']),
    })
    .parse(env);
  for (const value of [c.RUNTIME_DATABASE_URL, c.AUTH_DATABASE_URL]) {
    const u = new URL(value);
    const local = ['127.0.0.1', 'localhost'].includes(u.hostname);
    if (c.DATABASE_REGION === 'local' && (!local || env.VERCEL_ENV))
      throw new Error('Local databases are for local development only');
    if (
      !local &&
      (!u.hostname.endsWith('.neon.tech') ||
        !u.hostname.includes(c.DATABASE_REGION.replace('aws-', '') + '.aws.neon.tech'))
    )
      throw new Error('Database host does not match the approved EU region');
    if (!local && u.searchParams.get('sslmode') !== 'verify-full')
      throw new Error('Remote PostgreSQL requires full TLS verification');
  }
  if (new URL(c.RUNTIME_DATABASE_URL).username === new URL(c.AUTH_DATABASE_URL).username)
    throw new Error('Runtime and identity database roles must be separate');
  const runtime = new URL(c.RUNTIME_DATABASE_URL),
    auth = new URL(c.AUTH_DATABASE_URL);
  if (
    runtime.hostname !== auth.hostname ||
    runtime.port !== auth.port ||
    runtime.pathname !== auth.pathname
  )
    throw new Error('Runtime and identity roles must use the same isolated database');
  const origin = new URL(c.APP_ORIGIN);
  if (
    origin.origin !== c.APP_ORIGIN ||
    (!['localhost', '127.0.0.1'].includes(origin.hostname) && origin.protocol !== 'https:')
  )
    throw new Error('An exact HTTPS application origin is required');
  return c;
}
