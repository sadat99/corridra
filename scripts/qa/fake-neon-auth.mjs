// Test-only stand-in for the Neon Auth session endpoint, loaded with `node --import` by the local
// verification server and nothing else. It answers one request in the server process, GET <base>/get-session,
// for one synthetic customer whose session token the server made up for this run. Every other request
// goes to the real fetch untouched.
//
// It adds no sign-in code to the app: the app still asks the Neon Auth SDK for the session and the SDK
// still checks the answer. It refuses to start unless the process is plainly a local synthetic test.
const names = [
  'QA_FAKE_NEON_AUTH_BASE_URL',
  'QA_FAKE_NEON_AUTH_TOKEN',
  'QA_FAKE_NEON_AUTH_SUBJECT',
  'QA_FAKE_NEON_AUTH_EMAIL',
];
const missing = names.filter((name) => !process.env[name]);
if (
  missing.length ||
  process.env.DATA_ENVIRONMENT !== 'synthetic' ||
  process.env.VERCEL_ENV ||
  !String(process.env.APP_ORIGIN).startsWith('http://127.0.0.1:') ||
  process.env.QA_FAKE_NEON_AUTH_TOKEN.length < 32
)
  throw new Error('The test sign-in stand-in only runs in a local synthetic test.');

const base = new URL(process.env.QA_FAKE_NEON_AUTH_BASE_URL);
const token = process.env.QA_FAKE_NEON_AUTH_TOKEN;
const subject = process.env.QA_FAKE_NEON_AUTH_SUBJECT;
const email = process.env.QA_FAKE_NEON_AUTH_EMAIL;
const cookieName = '__Secure-neon-auth.session_token';
const realFetch = globalThis.fetch;

globalThis.fetch = async function standIn(input, init) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.host !== base.host) return realFetch(input, init);
  if (url.pathname !== `${base.pathname}/get-session`) return new Response('{}', { status: 404 });
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : {}));
  const signedIn = (headers.get('cookie') ?? '')
    .split(';')
    .some((part) => part.trim() === `${cookieName}=${token}`);
  if (!signedIn) return Response.json(null);
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
      name: 'Synthetic Customer',
      createdAt: now,
      updatedAt: now,
    },
  });
};
