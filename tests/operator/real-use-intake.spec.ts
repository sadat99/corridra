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
import { realNoticeVersion } from '../../packages/domain/src/missions';
import { localeMeta, type Locale } from '../../apps/web/lib/i18n/locales';
import { words as ar } from '../../apps/web/lib/i18n/form-words/ar';
import { words as de } from '../../apps/web/lib/i18n/form-words/de';
import { formEn } from '../../apps/web/lib/i18n/form-words/en';

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
      import {POST as intake} from ${JSON.stringify(resolve('apps/web/app/api/intake/route.ts'))};
      import {POST as claim} from ${JSON.stringify(resolve('apps/web/app/api/intake/pending/claim/route.ts'))};
      import{GET as detail}from ${JSON.stringify(resolve('apps/web/app/api/customer-requests/[requestId]/route.ts'))};
      import {storage} from 'fixture-context';
      export async function handle(request){
        const values=new Map((request.headers.get('cookie')||'').split(';').filter(Boolean).map(part=>{const i=part.indexOf('=');return [part.slice(0,i).trim(),decodeURIComponent(part.slice(i+1))]}));
        const updates=[];const jar={get:name=>values.has(name)?{value:values.get(name)}:undefined,set:(name,value,options)=>updates.push(name+'='+encodeURIComponent(value)+'; Path='+options.path+'; HttpOnly; SameSite=Lax; Max-Age='+options.maxAge)};
        return storage.run(jar,async()=>{const response=await(new URL(request.url).pathname==='/api/intake'?intake(request):new URL(request.url).pathname.startsWith('/api/customer-requests/')?detail(request,{params:Promise.resolve({requestId:new URL(request.url).pathname.split('/').at(-1)})}):new URL(request.url).pathname.endsWith('/claim')?claim(request):request.method==='GET'?GET(request):POST(request));for(const value of updates)response.headers.append('set-cookie',value);return response});
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
      import{LanguageProvider}from ${JSON.stringify(resolve('apps/web/components/language-provider.tsx'))};
      import{FormMain}from ${JSON.stringify(resolve('apps/web/app/plan/form-main.tsx'))};
      import{AccountForm}from ${JSON.stringify(resolve('apps/web/components/account-form.tsx'))};
      import{CustomerRequestDetail}from ${JSON.stringify(resolve('apps/web/app/account/requests/request-detail.tsx'))};
      const path=location.pathname;const mode=path==='/signup'?'signup':path==='/verify-email'?'verify':'signin';
      const root=createRoot(document.getElementById('fixture'));
      if(path.startsWith('/account/requests/')){const {data}=await(await fetch('/fixture/auth/session')).json();root.render(<CustomerRequestDetail requestId={path.split('/').at(-1)} subject={data.user.id} issuer={"https://ep-real-browser-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth"}/>)}else if(path==='/plan'&&document.body.dataset.language){const all=['bn','zh','es','ar','fr','de'];const sample=new URLSearchParams(location.search).get('opened')==='before-real-use';root.render(<LanguageProvider offered={['en',...all].map((code)=>({code,draft:false}))}><FormMain released={all} className="ux-intake-page"><section className="guide-plan"><Intake realMode={!sample}/></section></FormMain></LanguageProvider>)}else root.render(path==='/plan'?<Intake realMode/>:<AccountForm mode={mode}/>);`,
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
      if (
        path === '/api/intake' ||
        path.startsWith('/api/intake/pending') ||
        path.startsWith('/api/customer-requests/')
      ) {
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
      // A language variant of the request page, chosen by a cookie: the request page's own main region with the
      // form released in every language, so the form can follow the chosen language. With `?opened=before-real-use`
      // it holds the sample form, as a tab opened before real use began still does. Without the cookie the document
      // is the one every other case uses.
      const language = req.headers.cookie?.match(
        /(?:^|;\s*)fixture_language=([a-z]{2})(?:;|$)/,
      )?.[1];
      if (path === '/plan' && language) {
        res.end(
          `<!doctype html><html lang="en" class="${fontClass}"><head><title>Real-use local fixture</title><link rel="stylesheet" href="/fixture.css"/></head><body data-language="${language}"><div class="site-shell" id="fixture"></div><script type="module" src="/fixture.js"></script></body></html>`,
        );
        return;
      }
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
      page.getByRole('heading', { name: 'Source suppliers in China', exact: true }),
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

// The request form in a released language (Lane 11): the same real handlers, database and account steps, with the
// form's words in German or Arabic. The request saved and claimed is the English one.
const formWords = { de, ar };
async function chooseLanguage(page: Page, code: Locale) {
  await page.context().addCookies([{ name: 'fixture_language', value: code, url: origin }]);
  await page.addInitScript((value) => localStorage.setItem('corridra.language', value), code);
}
/** Fills the real request with structural selectors only, so it works in every language. A signed-in person has no
 * password to set. */
async function fillRequestInAnyLanguage(page: Page, email: string, password?: string) {
  const form = page.locator('form.intake-form');
  const next = form.locator('.guide-actions .primary-link');
  const step = async () => {
    const before = await form.locator('h2').textContent();
    await next.click();
    await expect(form.locator('h2')).not.toHaveText(before ?? '');
  };
  await form.locator('select').first().selectOption('sourcing');
  await step();
  await form.locator('select').nth(0).selectOption('BD');
  await form.locator('select').nth(1).selectOption('CN');
  await step();
  await form
    .locator('textarea')
    .first()
    .fill('Prepare machinery supplier meetings for our factory');
  await step();
  await form.locator('input[type="checkbox"]').first().check();
  await step();
  await form.locator('#brief-name').fill('Request owner');
  await form.locator('#brief-company').fill('Dhaka Manufacturing');
  await form.locator('#brief-email').fill(email);
  await form.locator('label.choice input[type="checkbox"]').check();
  if (password) await form.locator('input[type="password"]').fill(password);
  return next;
}
for (const code of ['de', 'ar'] as const)
  test(`a real request completes in ${code}: saved for 24 hours, the account activated, and the request claimed`, async ({
    page,
  }) => {
    const email = `language-${code}@business.test`,
      password = 'Browser fixture account password';
    await chooseLanguage(page, code);
    await page.goto(origin + '/plan');
    await expect(page.locator('#main')).toHaveAttribute('lang', localeMeta[code].html);
    await expect(page.locator('#main')).toHaveAttribute('dir', localeMeta[code].dir);
    const send = await fillRequestInAnyLanguage(page, email, password);
    await expect(send).toHaveText(formWords[code]['form.action.createAccount']);
    await expect(page.locator('label.choice').last()).toHaveAttribute('lang', 'en');
    await send.click();
    await activate(page, email, password);
    await expect(page).toHaveURL(/\/account\/requests\/[a-f0-9-]{36}$/);
    // The request in the account is the English one: the stored objective and market are the English values.
    await expect(
      page.getByRole('heading', { name: 'Source suppliers in China', exact: true }),
    ).toBeVisible();
    const rows = (
      await owner.query(
        "SELECT brief, notice_version FROM customer_private.pending_request WHERE brief->>'email'=$1",
        [email],
      )
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].notice_version).toBe(realNoticeVersion);
    expect(rows[0].brief).toMatchObject({ objective: 'Source suppliers', market: 'China' });
  });

test('the saved request and the sign-up call are byte for byte the same in en, de and ar', async ({
  browser,
}) => {
  const email = 'language-same@business.test',
    password = 'Browser fixture account password';
  const sent = async (code: Locale) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(() => {
      crypto.randomUUID = () => '00000000-0000-4000-8000-000000000003';
    });
    const bodies: string[] = [];
    const signUps: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/fixture/auth/signup'))
        signUps.push(request.postData() ?? '');
    });
    if (code === 'en')
      page.on('request', (request) => {
        if (request.method() === 'POST' && request.url().endsWith('/api/intake/pending'))
          bodies.push(request.postData() ?? '');
      });
    else {
      // The English run saved the request; these runs only capture what would be sent.
      await chooseLanguage(page, code);
      await page.route('**/api/intake/pending', (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        bodies.push(route.request().postData() ?? '');
        return route.fulfill({ status: 201, json: { ok: true } });
      });
      await page.route('**/fixture/auth/signup', (route) =>
        route.fulfill({ json: { data: {}, error: null } }),
      );
    }
    await page.goto(origin + '/plan');
    if (code !== 'en')
      await expect(page.locator('#main')).toHaveAttribute('lang', localeMeta[code].html);
    await (await fillRequestInAnyLanguage(page, email, password)).click();
    await expect(page).toHaveURL(/\/verify-email\?returnTo=%2Fplan/);
    await context.close();
    expect(bodies).toHaveLength(1);
    expect(signUps).toHaveLength(1);
    return { saved: bodies[0], signUp: signUps[0] };
  };
  const english = await sent('en');
  expect(JSON.parse(english.saved!).brief).toMatchObject({
    market: 'China',
    objective: 'Source suppliers',
  });
  expect(JSON.parse(english.signUp!)).toEqual({ name: 'Request owner', email, password });
  for (const code of ['de', 'ar'] as const) {
    const translated = await sent(code);
    expect(translated.saved, code).toBe(english.saved);
    expect(translated.signUp, code).toBe(english.signUp);
  }
  const rows = (
    await owner.query(
      "SELECT notice_version FROM customer_private.pending_request WHERE brief->>'email'=$1",
      [email],
    )
  ).rows;
  expect(rows).toEqual([{ notice_version: realNoticeVersion }]);
});

test('de: signed in, an email other than the account is blocked and the form says so in German', async ({
  page,
}) => {
  const email = 'language-signed-in@business.test',
    other = 'language-someone-else@business.test',
    password = 'Browser fixture standalone password';
  await page.goto(origin + '/signup?returnTo=%2Fplan');
  await page.getByLabel('Name', { exact: true }).fill('Signed in owner');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await activate(page, email, password);
  await expect(page).toHaveURL(origin + '/plan');
  await chooseLanguage(page, 'de');
  await page.goto(origin + '/plan');
  await expect(page.locator('#main')).toHaveAttribute('lang', 'de');
  const send = await fillRequestInAnyLanguage(page, other);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(send).toHaveText(de['form.action.submit']);
  await send.click();
  await expect(page.locator('.guide-status')).toHaveText(de['form.message.emailMismatch']);
  await expect(page.locator('#brief-email')).toHaveValue(other);
  // Nothing was saved for either address.
  const rows = (
    await owner.query(
      "SELECT 1 FROM customer_private.pending_request WHERE brief->>'email' = ANY($1::text[])",
      [[email, other]],
    )
  ).rows;
  expect(rows).toEqual([]);
});

test('de: signed out in real use, the form needs an account, and a request from a tab opened before real use is refused in German with nothing saved', async ({
  page,
}) => {
  // The refusal is the real handler's, read from its source and answered by it below.
  const [, refusal, status] =
    (await readFile('apps/web/app/api/intake/route.ts', 'utf8')).match(
      /if \(realUseEnabled\(\)\)\s*throw new DomainError\('([^']+)', (\d+)\)/,
    ) ?? [];
  expect(refusal).toBe(formEn['form.message.activationNeeded']);
  const saved = async () =>
    (
      await owner.query(
        'SELECT (SELECT count(*) FROM app.mission_intake)::int AS intake, (SELECT count(*) FROM customer_private.pending_request)::int AS pending',
      )
    ).rows[0];
  const before = await saved();
  const posts: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') posts.push(new URL(request.url()).pathname);
  });
  await chooseLanguage(page, 'de');
  // Real use, signed out: without a password there is no account, so nothing is sent.
  await page.goto(origin + '/plan');
  await expect(page.locator('#main')).toHaveAttribute('lang', 'de');
  const create = await fillRequestInAnyLanguage(page, 'language-refused@business.test');
  await expect(create).toHaveText(de['form.action.createAccount']);
  await create.click();
  await expect(page.locator('.guide-status')).toHaveText(de['form.message.passwordShort']);
  expect(posts).toEqual([]);
  // A tab opened before real use began still holds the sample form; the server refuses what it sends.
  await page.goto(origin + '/plan?opened=before-real-use');
  await expect(page.locator('#main')).toHaveAttribute('lang', 'de');
  const send = await fillRequestInAnyLanguage(page, 'language-refused@example.invalid');
  await expect(send).toHaveText(de['form.action.submit']);
  const answered = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/intake',
  );
  await send.click();
  const answer = await answered;
  expect(answer.status()).toBe(Number(status));
  expect(await answer.json()).toEqual({ error: refusal });
  await expect(page.locator('.guide-status')).toHaveText(de['form.message.activationNeeded']);
  await expect(page.locator('.guide-status [lang="en"]')).toHaveCount(0);
  // No receipt was issued: the receipt heading and its read-only code never appear.
  await expect(page.locator('#plan-receipt-title')).toHaveCount(0);
  await expect(page.locator('.receipt-panel input[readonly]')).toHaveCount(0);
  await expect(page.locator('#brief-name')).toHaveValue('Request owner');
  expect(posts).toEqual(['/api/intake']);
  expect(await saved()).toEqual(before);
});
