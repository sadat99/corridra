import 'server-only';
import { createNeonAuth } from '@neondatabase/auth/next/server';
import { readNeonAuthConfig } from '@corridra/config';
let singleton: ReturnType<typeof createNeonAuth> | null | undefined;
export function neonAuth() {
  if (singleton !== undefined) return singleton;
  const config = readNeonAuthConfig();
  singleton = config
    ? createNeonAuth({
        baseUrl: config.NEON_AUTH_BASE_URL,
        cookies: { secret: config.NEON_AUTH_COOKIE_SECRET, sessionDataTtl: 1, sameSite: 'lax' },
        logLevel: 'silent',
      })
    : null;
  return singleton;
}
