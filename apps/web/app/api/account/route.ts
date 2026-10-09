import { neonAuth } from '../../../lib/neon-auth';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
export async function GET() {
  try {
    const auth = neonAuth();
    if (!auth)
      return Response.json(
        { error: 'Account sign-in is not available yet' },
        { status: 503, headers },
      );
    const { data, error } = await auth.getSession({ query: { disableCookieCache: true } });
    if (error)
      return Response.json({ error: 'Account service is unavailable' }, { status: 503, headers });
    if (!data?.user)
      return Response.json({ error: 'Sign in to continue' }, { status: 401, headers });
    if (!data.user.emailVerified)
      return Response.json({ error: 'Verify your email to continue' }, { status: 403, headers });
    return Response.json(
      {
        user: {
          id: data.user.id,
          name: data.user.name,
          email: data.user.email,
          emailVerified: true,
        },
      },
      { headers },
    );
  } catch {
    return Response.json({ error: 'Account service is unavailable' }, { status: 503, headers });
  }
}
