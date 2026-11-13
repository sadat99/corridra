// Test-only stand-in for the Neon Auth session endpoint, loaded with `node --import` by the local
// verification server and nothing else. It answers one request in the server process, GET <base>/get-session,
// for one synthetic customer whose session token the server made up for this run. Every other request
// goes to the real fetch untouched.
//
// It adds no sign-in code to the app: the app still asks the Neon Auth SDK for the session and the SDK
// still checks the answer. It refuses to start unless the process is plainly a local synthetic test.
// One user comes from the three single-user variables; several come from QA_FAKE_NEON_AUTH_USERS, a JSON list of
// { token, subject, email, name } made up for this run (used by scripts/qa/signed-in-sweep.ts). Both can be set.
const users = [];
if (process.env.QA_FAKE_NEON_AUTH_TOKEN)
  users.push({
    token: process.env.QA_FAKE_NEON_AUTH_TOKEN,
    subject: process.env.QA_FAKE_NEON_AUTH_SUBJECT,
    email: process.env.QA_FAKE_NEON_AUTH_EMAIL,
    name: 'Synthetic Customer',
  });
if (process.env.QA_FAKE_NEON_AUTH_USERS)
  users.push(...JSON.parse(process.env.QA_FAKE_NEON_AUTH_USERS));
if (
  !process.env.QA_FAKE_NEON_AUTH_BASE_URL ||
  !users.length ||
  users.some((u) => !u.subject || !u.email || String(u.token).length < 32) ||
  process.env.DATA_ENVIRONMENT !== 'synthetic' ||
  process.env.VERCEL_ENV ||
  !String(process.env.APP_ORIGIN).startsWith('http://127.0.0.1:')
)
  throw new Error('The test sign-in stand-in only runs in a local synthetic test.');

const base = new URL(process.env.QA_FAKE_NEON_AUTH_BASE_URL);
const cookieName = '__Secure-neon-auth.session_token';
const realFetch = globalThis.fetch;

globalThis.fetch = async function standIn(input, init) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.host !== base.host) return realFetch(input, init);
  if (url.pathname !== `${base.pathname}/get-session`) return new Response('{}', { status: 404 });
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : {}));
  const parts = (headers.get('cookie') ?? '').split(';').map((part) => part.trim());
  const user = users.find((u) => parts.includes(`${cookieName}=${u.token}`));
  if (!user) return Response.json(null);
  const { token, subject, email } = user;
  const now = new Date().toISOString();
  const later = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  return Response.json({
    session: {
      id: 'qa-session',
      token,
      userId: subject,
      expiresAt: later,
      createdAt: now,
      updatedAt: now,
    },
    user: {
      id: subject,
      email,
      emailVerified: true,
      name: user.name ?? 'Synthetic Customer',
      createdAt: now,
      updatedAt: now,
    },
  });
};
