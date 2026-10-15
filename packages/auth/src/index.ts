import { betterAuth } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import { z } from 'zod';
import type { Pool } from '@corridra/db';
import * as schema from '@corridra/db/schema';
import type { PasswordRecoveryMail } from './recovery-mail';
export interface IdentityProvider {
  getSession(headers: Headers): Promise<{ token: string; userId: string; name: string } | null>;
  revokeSession(headers: Headers, token: string): Promise<void>;
}
export function createIdentity(options: {
  pool: Pool;
  secret: string;
  baseURL: string;
  basePath?: string;
  sendPasswordRecovery?: (message: PasswordRecoveryMail) => Promise<void>;
}) {
  if (options.secret.length < 32)
    throw new Error('Identity secret must contain at least 32 characters');
  const db = drizzle(options.pool, { schema });
  const auth = betterAuth({
    logger: { disabled: true },
    appName: 'Corridra',
    baseURL: options.baseURL,
    basePath: options.basePath ?? '/api/auth',
    secret: options.secret,
    trustedOrigins: [new URL(options.baseURL).origin],
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 14,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 1800,
      revokeSessionsOnPasswordReset: true,
      ...(options.sendPasswordRecovery
        ? {
            sendResetPassword: async ({
              user,
              url,
            }: {
              user: { id: string; email: string };
              url: string;
            }) => {
              const eligible = await options.pool.query(
                'SELECT p.id FROM identity.principal p JOIN identity."user" u ON u.id=p.identity_id WHERE u.id=$1 AND u."emailVerified"=true AND p.disabled_at IS NULL',
                [user.id],
              );
              if (eligible.rowCount)
                await options.sendPasswordRecovery!({ email: user.email, url });
            },
          }
        : {}),
    },
    session: { expiresIn: 86400, updateAge: 3600, freshAge: 300, cookieCache: { enabled: false } },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 60,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/two-factor/*': { window: 60, max: 5 },
        '/request-password-reset': { window: 60, max: 5 },
        '/reset-password': { window: 60, max: 5 },
      },
    },
    advanced: {
      useSecureCookies: new URL(options.baseURL).protocol === 'https:',
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
    },
    plugins: [
      twoFactor({
        issuer: 'Corridra',
        skipVerificationOnEnable: false,
        accountLockout: { enabled: true, maxFailedAttempts: 5, durationSeconds: 900 },
      }),
    ],
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/two-factor/verify-totp') return;
        const result = z
          .object({ token: z.string(), user: z.object({ id: z.string() }) })
          .safeParse(ctx.context.returned);
        if (!result.success) return;
        const token = ctx.context.newSession?.session.token ?? result.data.token;
        await options.pool.query(
          `INSERT INTO identity.assurance(session_id,verified_at,method)
    SELECT s.id,now(),'totp' FROM identity.session s JOIN identity."user" u ON u.id=s."userId"
    JOIN identity."twoFactor" t ON t."userId"=u.id
    WHERE s.token=$1 AND u.id=$2 AND u."twoFactorEnabled"=true AND t.verified=true AND s."expiresAt">now()
    ON CONFLICT(session_id) DO UPDATE SET verified_at=EXCLUDED.verified_at,method=EXCLUDED.method`,
          [token, result.data.user.id],
        );
      }),
    },
  });
  const provider: IdentityProvider = {
    async getSession(headers) {
      const s = await auth.api.getSession({ headers });
      return s ? { token: s.session.token, userId: s.user.id, name: s.user.name } : null;
    },
    async revokeSession(headers, token) {
      await auth.api.revokeSession({ headers, body: { token } });
    },
  };
  const handler = async (request: Request) => {
    const path = new URL(request.url).pathname;
    const recoveryPath =
      path.startsWith((options.basePath ?? '/api/auth') + '/reset-password') ||
      path === (options.basePath ?? '/api/auth') + '/request-password-reset';
    if (recoveryPath && !options.sendPasswordRecovery)
      return Response.json(
        { error: 'Operator recovery is unavailable' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    if (
      request.method === 'POST' &&
      request.headers.get('origin') !== new URL(options.baseURL).origin
    )
      return Response.json(
        { error: 'Request origin is not allowed' },
        { status: 403, headers: { 'Cache-Control': 'no-store' } },
      );
    if (request.method === 'POST' && path.endsWith('/request-password-reset')) {
      const body = await request
        .clone()
        .json()
        .catch(() => null);
      if (body?.redirectTo !== new URL('/operator/reset-password', options.baseURL).href)
        return Response.json(
          { error: 'Recovery destination is not allowed' },
          { status: 400, headers: { 'Cache-Control': 'no-store' } },
        );
    }
    return auth.handler(request);
  };
  return { auth, provider, handler };
}
