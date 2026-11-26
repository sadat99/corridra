// Whether this request may carry a customer session (final walk m2, 25 Nov 2026). The operator sign-in page draws the
// invitation hint only then: the hint asks /api/operator-setup, which answers 401 to a visitor with no customer session
// (and 503 where customer accounts are not set up), and a signed-out visit is the expected state there, not an error.
// The cookie is only looked for, never read or checked; a stale one costs the one request the hint always made.
const customerTokenCookie = /^(?:__Secure-)?neon-auth\.session_token$/;

export function customerSessionHinted(cookies: readonly { name: string; value: string }[]) {
  return cookies.some((cookie) => customerTokenCookie.test(cookie.name) && cookie.value !== '');
}
