import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { Pool } from '../../packages/db/src/index';
import { migrate } from '../../packages/db/src/migrate';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { seedSyntheticWorkspace } from '../../packages/auth/src/bootstrap';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';
import { pinCustomerAuthority } from '../../packages/auth/src/customer-authority-pin';
import { configureCustomerRealUse } from '../../packages/auth/src/customer-real-use-configuration';
import { MissionService } from '../../packages/missions/src/index';
import { CustomerRequestService } from '../../packages/auth/src/customer-requests';
import { CustomerRequestDetailService } from '../../packages/auth/src/customer-request-details';

// The browser uses actual intake/account components, HTTP adapters, domain services
// and restricted PostgreSQL roles. Only identity-provider transport is invented.
// This proves continuation and ownership, never managed-provider mail delivery.
type User = { id: string; name: string; email: string; emailVerified: boolean };
const identity = new AsyncLocalStorage<User | undefined>();
const users = new Map<string, User>();
const issuer =
  'https://ep-real-browser-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
let server: Server, origin: string, owner: Pool, runtime: Pool, auth: Pool;
const savedEnvironment = {
  DATA_ENVIRONMENT: process.env.DATA_ENVIRONMENT,
  CORRIDRA_REAL_USE_ENABLED: process.env.CORRIDRA_REAL_USE_ENABLED,
  CORRIDRA_CUSTOMER_REQUESTS_ENABLED: process.env.CORRIDRA_CUSTOMER_REQUESTS_ENABLED,
  CORRIDRA_CUSTOMER_REQUEST_DETAILS_ENABLED: process.env.CORRIDRA_CUSTOMER_REQUEST_DETAILS_ENABLED,
};
test.beforeAll(async () => {
  process.env.DATA_ENVIRONMENT = 'real';
  process.env.CORRIDRA_REAL_USE_ENABLED = 'true';
  process.env.CORRIDRA_CUSTOMER_REQUESTS_ENABLED = 'true';
  process.env.CORRIDRA_CUSTOMER_REQUEST_DETAILS_ENABLED = 'true';
  const local = JSON.parse(await readFile('.cache/part03-local.json', 'utf8'));
  const connection = {
    host: '127.0.0.1',
    port: 54329,
    user: 'postgres',
    password: local.ownerPassword,
  };
  const root = new Pool({ ...connection, database: 'postgres' });
  await root.query('DROP DATABASE IF EXISTS corridra_browser_real_use WITH (FORCE)');
  await root.query('CREATE DATABASE corridra_browser_real_use');
  await root.end();
  owner = new Pool({ ...connection, database: 'corridra_browser_real_use' });
  runtime = new Pool({
    ...connection,
    database: 'corridra_browser_real_use',
    user: 'corridra_runtime_local',
    password: local.runtimePassword,
  });
  auth = new Pool({
    ...connection,
    database: 'corridra_browser_real_use',
    user: 'corridra_auth_local',
    password: local.authPassword,
  });
  await migrate(owner);
  const seed = await seedSyntheticWorkspace(owner, {
    email: 'real-browser-operator@example.invalid',
    password: randomBytes(24).toString('base64url'),
    name: 'Synthetic browser operator',
  });
  await configureSyntheticIntake(owner, seed.tenantId, seed.principalId);
  await migrateCustomerRealUse(owner);
  const executor = (await owner.query('SELECT service_id FROM app.intake_destination')).rows[0]
    .service_id;
  await pinCustomerAuthority(owner, { issuer, executorId: executor });
  await configureCustomerRealUse(owner, {
    enabled: true,
    reason: 'Local browser fixture for explicit real-use scanning deferral',
  });
  const missions = new MissionService(runtime, randomBytes(32).toString('hex'), 'real');
  const customerRequests = new CustomerRequestService(
    runtime,
    auth,
    {
      enabled: true,
      synthetic: false,
      production: false,
      issuer,
      openAdmission: true,
      dataMode: 'real',
    },
    async () => {
      const user = identity.getStore();
      return user
        ? {
            subject: user.id,
            email: user.email,
            emailVerified: user.emailVerified,
            expiresAt: new Date(Date.now() + 60000),
          }
        : null;
    },
  );
  const customerRequestDetails = new CustomerRequestDetailService(
    runtime,
    auth,
    {
      enabled: true,
      synthetic: false,
      production: false,
      issuer,
      openAdmission: true,
      dataMode: 'real',
    },
    async () => {
      const user = identity.getStore();
      return user
        ? {
            subject: user.id,
            email: user.email,
            emailVerified: user.emailVerified,
            expiresAt: new Date(Date.now() + 60000),
          }
        : null;
    },
  );
  const cssDocument = await (await fetch('http://127.0.0.1:3200/')).text();
  const cssPaths = [
    ...new Set(
      [...cssDocument.matchAll(/href="(\/_next\/static\/[^"?]+\.css)/g)].map((match) => match[1]),
    ),
  ];
  expect(cssPaths.length).toBeGreaterThan(0);
  const css = (
    await Promise.all(
      cssPaths.map(async (path) => (await fetch('http://127.0.0.1:3200' + path)).text()),
    )
  ).join('\n');
  const fontClass = cssDocument.match(/<html[^>]*class="([\w -]+)"/)?.[1] ?? '';
  const require = createRequire(import.meta.url);
  const directory = resolve('work/real-use/browser-fixture');
  await mkdir(directory, { recursive: true });
  // Bundle the actual Next handlers with request-scoped cookie/foundation adapters.
  // There are no fixture hooks or provider bypasses in production source.
  const apiFile = resolve(directory, 'api.mjs');
  await build({
    stdin: {
      contents: `import {GET,POST} from ${JSON.stringify(resolve('apps/web/app/api/intake/pending/route.ts'))};
      import {POST as claim} from ${JSON.stringify(resolve('apps/web/app/api/intake/pending/claim/route.ts'))};
      import{GET as detail}from ${JSON.stringify(resolve('apps/web/app/api/customer-requests/[requestId]/route.ts'))};
      import {storage} from 'fixture-context';
      export async function handle(request){
        const values=new Map((request.headers.get('cookie')||'').split(';').filter(Boolean).map(part=>{const i=part.indexOf('=');return [part.slice(0,i).trim(),decodeURIComponent(part.slice(i+1))]}));
        const updates=[];const jar={get:name=>values.has(name)?{value:values.get(name)}:undefined,set:(name,value,options)=>updates.push(name+'='+encodeURIComponent(value)+'; Path='+options.path+'; HttpOnly; SameSite=Lax; Max-Age='+options.maxAge)};
        return storage.run(jar,async()=>{const response=await(new URL(request.url).pathname.startsWith('/api/customer-requests/')?detail(request,{params:Promise.resolve({requestId:new URL(request.url).pathname.split('/').at(-1)})}):new URL(request.url).pathname.endsWith('/claim')?claim(request):request.method==='GET'?GET(request):POST(request));for(const value of updates)response.headers.append('set-cookie',value);return response});
      }`,
      resolveDir: resolve('.'),
      loader: 'ts',
    },
    outfile: apiFile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    plugins: [
      {
        name: 'actual-handler-fixture',
        setup(b) {
          b.onResolve({ filter: /^pg$/ }, () => ({
            path: resolve(
              require.resolve('pg/package.json', { paths: [resolve('packages/db')] }),
              '..',
              'esm/index.mjs',
            ),
            external: true,
          }));
          b.onResolve({ filter: /^@corridra\// }, (args) => ({
            path: require.resolve(args.path, { paths: [resolve('apps/web')] }),
          }));
          b.onResolve(
            { filter: /^(fixture-context|next\/headers|server-only)$|\/foundations$/ },
            (args) => ({ path: args.path, namespace: 'fixture' }),
          );
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
            contents:
              args.path === 'server-only'
                ? ''
                : args.path === 'fixture-context'
                  ? "import{AsyncLocalStorage}from'node:async_hooks';export const storage=new AsyncLocalStorage();"
                  : args.path === 'next/headers'
                    ? "import{storage}from'fixture-context';export async function cookies(){return storage.getStore()}"
                    : 'export function foundations(){return globalThis.__realUseFixtureServices}',
          }));
        },
      },
    ],
  });
  const api = await import(pathToFileURL(apiFile).href);
  const browser = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{Intake}from ${JSON.stringify(resolve('apps/web/app/plan/intake.tsx'))};
      import{AccountForm}from ${JSON.stringify(resolve('apps/web/components/account-form.tsx'))};
      import{CustomerRequestDetail}from ${JSON.stringify(resolve('apps/web/app/account/requests/request-detail.tsx'))};
      const path=location.pathname;const mode=path==='/signup'?'signup':path==='/verify-email'?'verify':'signin';
      const root=createRoot(document.getElementById('fixture'));
      if(path.startsWith('/account/requests/')){const {data}=await(await fetch('/fixture/auth/session')).json();root.render(<CustomerRequestDetail requestId={path.split('/').at(-1)} subject={data.user.id} issuer={"https://ep-real-browser-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth"}/>)}else root.render(path==='/plan'?<Intake realMode/>:<AccountForm mode={mode}/>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    // Components import their own stylesheets; this spec does not mount them for styling.
    loader: { '.css': 'empty' },
    define: {
      'process.env.NODE_ENV': '"production"',
      'process.env.NEXT_PUBLIC_CORRIDRA_REAL_USE_ENABLED': '"true"',
      'process.env': '{}',
    },
    plugins: [
      {
        name: 'provider-transport-fixture',
        setup(b) {
          b.onResolve({ filter: /neon-auth-client$|^next\/(link|navigation)$/ }, (args) => ({
            path: args.path,
            namespace: 'fixture',
          }));
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
            loader: 'tsx',
            resolveDir: resolve('apps/web'),
            contents:
              args.path === 'next/link'
                ? 'export default function Link(props){return <a {...props}/>}'
                : args.path === 'next/navigation'
                  ? 'const router={replace:path=>location.assign(path),refresh:()=>{}};export function useRouter(){return router}export function useSearchParams(){return new URLSearchParams(location.search)}'
                  : `async function call(path,body){return(await fetch('/fixture/auth/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined})).json()};export const accountClient={getSession:()=>call('session'),signUp:{email:body=>call('signup',body)},signIn:{email:body=>call('signin',body)},emailOtp:{verifyEmail:body=>call('verify',body),sendVerificationOtp:body=>call('send-code',body)}};`,
          }));
        },
      },
    ],
  });
  server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url!, origin).pathname;
      const token = req.headers.cookie?.match(/(?:^|;\s*)fixture_customer=([^;]+)/)?.[1];
      let user = token ? users.get(token) : undefined;
      if (path === '/fixture.js') {
        res.setHeader('content-type', 'text/javascript');
        res.end(browser.outputFiles[0].text);
        return;
      }
      if (path === '/fixture.css') {
        res.setHeader('content-type', 'text/css');
        res.end(css);
        return;
      }
      if (path.startsWith('/fixture/auth/')) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
        if (path.endsWith('/signup')) {
          if (typeof body.password !== 'string' || body.password.length < 14)
            throw new Error('Fixture password validation');
          const key = randomUUID();
          user = { id: randomUUID(), name: body.name, email: body.email, emailVerified: false };
          users.set(key, user);
          res.setHeader('set-cookie', `fixture_customer=${key}; HttpOnly; SameSite=Lax; Path=/`);
        }
        if (path.endsWith('/verify')) {
          if (!user || body.email !== user.email || body.otp !== '123456')
            throw new Error('Fixture verification denied');
          user.emailVerified = true;
        }
        if (path.endsWith('/signin') && (!user || body.email !== user.email || !user.emailVerified))
          throw new Error('Fixture sign-in denied');
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ data: { user: user ?? null }, error: null }));
        return;
      }
      if (path.startsWith('/api/intake/pending') || path.startsWith('/api/customer-requests/')) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const request = new Request(origin + req.url, {
          method: req.method,
          headers: req.headers as HeadersInit,
          body: req.method === 'GET' ? undefined : new Uint8Array(Buffer.concat(chunks)),
        });
        const response: Response = await identity.run(user, () => api.handle(request));
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headers[key] = value;
        });
        res.writeHead(response.status, headers);
        res.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      if (path.startsWith('/account/requests/')) {
        const list = await identity.run(user, () => customerRequests.list());
        const id = path.split('/').at(-1);
        if (!list.requests.some((row: { id: string }) => row.id === id)) {
          res.writeHead(403);
          res.end('Private request unavailable');
          return;
        }
      }
      res.setHeader('content-type', 'text/html');
      res.end(
        `<!doctype html><html lang="en" class="${fontClass}"><head><title>Real-use local fixture</title><link rel="stylesheet" href="/fixture.css"/></head><body><main class="ux-intake-page"><h1>${path.startsWith('/account/requests/') ? 'Your private request' : 'Plan your request'}</h1><div class="guide-plan" id="fixture"></div></main><script type="module" src="/fixture.js"></script></body></html>`,
      );
    } catch (error) {
      res.statusCode = 500;
      res.setHeader('content-type', 'text/plain; charset=utf-8');
      res.end(error instanceof Error ? error.message : 'Fixture failure');
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address missing');
  origin = `http://127.0.0.1:${address.port}`;
  Object.assign(globalThis, {
    __realUseFixtureServices: {
      ready: Promise.resolve(),
      config: { APP_ORIGIN: origin },
      missions,
      customerRequests,
      customerRequestDetails,
    },
  });
});
test.afterAll(async () => {
  if (server) await new Promise<void>((done) => server.close(() => done()));
  await Promise.all([owner?.end(), runtime?.end(), auth?.end()]);
  for (const [key, value] of Object.entries(savedEnvironment))
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  Reflect.deleteProperty(globalThis, '__realUseFixtureServices');
});
async function fillRequest(page: Page, email: string) {
  await page.goto(origin + '/plan');
  await page
    .getByRole('combobox', { name: 'Commercial job', exact: true })
    .selectOption('sourcing');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Where is the company based?', exact: true })
    .selectOption('BD');
  await page
    .getByRole('combobox', { name: 'Which market is involved?', exact: true })
    .selectOption('CN');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page
    .getByLabel('Your offer or requirement')
    .fill('Prepare machinery supplier meetings for our factory');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Relevant meetings', { exact: true }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Request owner');
  await page.getByLabel('Company', { exact: true }).fill('Dhaka Manufacturing');
  await page.getByLabel('Work email', { exact: true }).fill(email);
  await page.getByLabel('I have read the privacy and request notice', { exact: false }).check();
}
async function activate(page: Page, email: string, password: string) {
  await expect(page).toHaveURL(/\/verify-email\?returnTo=%2Fplan/);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Verification code', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect(page).toHaveURL(/\/signin\?returnTo=%2Fplan/);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}
for (const width of [1366, 390])
  test(`guest request survives account activation and becomes privately owned at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const email = `guest-${width}@business.test`,
      password = 'Browser fixture account password';
    const writes: { url: string; body: string }[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST')
        writes.push({ url: request.url(), body: request.postData() ?? '' });
    });
    await fillRequest(page, email);
    await page.getByLabel('Create an account password', { exact: false }).fill(password);
    const stored = await page.evaluate(() =>
      [localStorage, sessionStorage]
        .flatMap((storage) => Object.keys(storage).map((key) => storage.getItem(key)))
        .join('\n'),
    );
    expect(stored).not.toContain(password);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `work/real-use/intake-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Create account and continue', exact: true }).click();
    await activate(page, email, password);
    await expect(page).toHaveURL(/\/account\/requests\/[a-f0-9-]{36}$/);
    await expect(
      page.getByRole('heading', { name: 'Your private request', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Source suppliers', exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/Sample data only/)).toHaveCount(0);
    const requests = (
      await owner.query(
        "SELECT brief FROM customer_private.pending_request WHERE brief->>'email'=$1",
        [email],
      )
    ).rows;
    expect(requests).toHaveLength(1);
    expect(JSON.stringify(requests)).not.toContain(password);
    expect(
      writes
        .filter((row) => row.body.includes(password))
        .every((row) => row.url.includes('/fixture/auth/')),
    ).toBe(true);
    expect(writes.filter((row) => row.url.endsWith('/api/intake/pending'))).toHaveLength(1);
    const cookies = await page.context().cookies(origin + '/api/intake/pending');
    expect(cookies.some((cookie) => cookie.name === 'corridra-pending-request')).toBe(false);
  });
test('standalone signup and activation can precede submission', async ({ page }) => {
  const email = 'account-first@business.test',
    password = 'Browser fixture standalone password';
  await page.goto(origin + '/signup?returnTo=%2Fplan');
  await page.getByLabel('Name', { exact: true }).fill('Account first owner');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await activate(page, email, password);
  await expect(page).toHaveURL(origin + '/plan');
  await fillRequest(page, email);
  await expect(page.getByLabel('Create an account password', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'Submit mission request', exact: true }).click();
  await expect(page).toHaveURL(/\/account\/requests\/[a-f0-9-]{36}$/);
});
test('fixture exceptions are returned as text and cannot be interpreted as HTML', async ({
  request,
}) => {
  const response = await request.post(origin + '/fixture/auth/verify', {
    data: '<svg onload="alert(1)">',
    headers: { 'content-type': 'application/json' },
  });
  expect(response.status()).toBe(500);
  expect(response.headers()['content-type']).toBe('text/plain; charset=utf-8');
});
