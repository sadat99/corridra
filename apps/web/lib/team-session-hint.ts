// A plain marker that a Corridra team session may exist in this browser (audit row public-customer-24). The team
// session cookie itself is HttpOnly, so the public header cannot see it; without a marker every public page asked
// /api/operator-auth/get-session on every load for every visitor. The marker holds no secret and grants nothing: it only
// lets the header skip that request when no team session can exist. A stale marker costs one request, as before.
// Set and cleared only by /api/operator-auth, whenever Better Auth sets or clears its session token, and whenever a
// session read answers (so a session that predates the marker gets one, and an ended one loses it).

export const teamSessionHintName = 'corridra-team';
// The team session lives 24 hours (packages/auth/src/index.ts `session.expiresIn`); the marker never outlives it.
const maxAge = 86400;

type HintState = 'on' | 'off' | null;

/** Whether this answer starts, keeps or ends a team session, read from its own headers and, for a session read, body. */
async function hintState(request: Request, response: Response): Promise<HintState> {
  const session = response.headers
    .getSetCookie()
    .find((cookie) => /^(?:__Secure-)?[\w.-]*session_token=/.test(cookie));
  if (session) return /^[^=]+=(?:;|$)/.test(session) || /max-age=0\b/i.test(session) ? 'off' : 'on';
  if (!new URL(request.url).pathname.endsWith('/get-session') || !response.ok) return null;
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => undefined);
  if (body === undefined) return null;
  return body && typeof body === 'object' && 'session' in body && body.session ? 'on' : 'off';
}

/** Adds the marker to (or clears it from) a team sign-in answer. The answer itself is not changed. */
export async function withTeamSessionHint(request: Request, response: Response, secure: boolean) {
  const state = await hintState(request, response);
  if (state)
    response.headers.append(
      'Set-Cookie',
      `${teamSessionHintName}=${state === 'on' ? '1' : ''}; Path=/; Max-Age=${state === 'on' ? maxAge : 0}; SameSite=Lax${secure ? '; Secure' : ''}`,
    );
  return response;
}

/** In the browser: true when the marker is present, so a team session may exist and is worth asking about. */
export function teamSessionHinted(cookies: string) {
  return cookies.split(';').some((part) => part.trim() === `${teamSessionHintName}=1`);
}
