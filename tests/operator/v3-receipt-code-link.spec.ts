import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

// The request page is prerendered, so real mode cannot be switched on at start. The real components
// are bundled instead, with the identity and request provider calls stubbed in the browser. This
// proves which links the request page offers and where they lead, not that a code is delivered.
const label = 'Sign in with a code to see your request';
let server: Server, origin: string;
let bundle = '';

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import{createRoot}from'react-dom/client';
      import{Intake}from ${JSON.stringify(resolve('apps/web/app/plan/intake.tsx'))};
      import{AccountForm}from ${JSON.stringify(resolve('apps/web/components/account-form.tsx'))};
      const q=new URLSearchParams(location.search);const on=q.get('switch')!=='off';
      const root=createRoot(document.getElementById('fixture'));
      root.render(location.pathname==='/signin'?<AccountForm mode="signin" codeSignIn={on}/>:<Intake realMode codeSignIn={on}/>);`,
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
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
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
                  : "const signedIn=()=>new URLSearchParams(location.search).get('as')==='person';export const accountClient={getSession:async()=>({data:signedIn()?{user:{id:'u',email:'person@example.invalid',emailVerified:false,name:'P'},session:{id:'s'}}:null,error:null}),signIn:{email:async()=>({data:null,error:null})},signUp:{email:async()=>({data:null,error:null})},emailOtp:{sendVerificationOtp:async()=>({data:{success:true},error:null}),verifyEmail:async()=>({data:null,error:null})}};",
          }));
        },
      },
    ],
  });
  bundle = result.outputFiles[0].text;
  server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://fixture.invalid').pathname;
    if (path === '/fixture.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(bundle);
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Receipt code link fixture</title></head><body><main id="main"><h1>Plan your request</h1><div id="fixture"></div></main><script type="module" src="/fixture.js"></script></body></html>',
    );
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture address missing');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

async function stub(page: Page, pending: boolean) {
  await page.route('**/api/intake/pending', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ pending, available: true }),
    }),
  );
}

test('with the switch off the request page offers no code sign-in link', async ({ page }) => {
  await stub(page, true);
  await page.goto(origin + '/plan?switch=off');
  await expect(page.getByRole('heading', { name: 'Finish your request.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in and continue' })).toBeVisible();
  await expect(page.getByRole('link', { name: label })).toHaveCount(0);
  await expect(page.locator('a[href*="method=code"]')).toHaveCount(0);
});

test('with the switch on, a person who is not signed in can ask for a code to see their request', async ({
  page,
}) => {
  await stub(page, true);
  await page.goto(origin + '/plan');
  const pendingPanel = page.getByRole('region', { name: 'Finish your request.' });
  await expect(pendingPanel).toBeVisible();
  await expect(pendingPanel.getByRole('link', { name: label })).toHaveAttribute(
    'href',
    '/signin?returnTo=%2Fplan&method=code',
  );
  // The password route stays the main action.
  await expect(pendingPanel.getByRole('link', { name: 'Sign in and continue' })).toHaveAttribute(
    'href',
    '/signin?returnTo=%2Fplan',
  );
  const check = page.locator('#receipt-check');
  await expect(check.getByRole('link', { name: label })).toHaveAttribute(
    'href',
    '/signin?method=code',
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  }
});

test('the link opens sign-in on its code option, and the password route stays one click away', async ({
  page,
}) => {
  await page.goto(origin + '/signin?method=code');
  const form = page.getByRole('form', { name: 'Account access' });
  await expect(form.getByRole('button', { name: 'Send code', exact: true })).toBeVisible();
  await expect(form.getByLabel('Password', { exact: true })).toHaveCount(0);
  await form.getByRole('button', { name: 'Use my password instead', exact: true }).click();
  await expect(form.getByLabel('Password', { exact: true })).toBeVisible();

  // With the switch off the same address opens the password form: the parameter is ignored.
  await page.goto(origin + '/signin?method=code&switch=off');
  const off = page.getByRole('form', { name: 'Account access' });
  await expect(off.getByLabel('Password', { exact: true })).toBeVisible();
  await expect(off.getByRole('button', { name: 'Send code', exact: true })).toHaveCount(0);
});

test('a signed-in person is not offered the link', async ({ page }) => {
  await stub(page, true);
  await page.goto(origin + '/plan?as=person');
  // The account is known once the pending panel offers to activate it instead of signing in.
  const pendingPanel = page.getByRole('region', { name: 'Finish your request.' });
  await expect(pendingPanel.getByRole('link', { name: 'Activate your account' })).toBeVisible();
  await expect(page.getByRole('link', { name: label })).toHaveCount(0);
  await expect(page.locator('a[href*="method=code"]')).toHaveCount(0);
});

test('a sample request page never offers account sign-in, because a sample request is not in an account', async ({
  page,
}) => {
  test.setTimeout(120000);
  const cli = createRequire(import.meta.url).resolve('next/dist/bin/next', {
    paths: [resolve('apps/web')],
  });
  const sampleOrigin = 'http://127.0.0.1:3417';
  const next = spawn(process.execPath, [cli, 'start', '--port', '3417'], {
    cwd: resolve('apps/web'),
    stdio: 'ignore',
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
      DATA_ENVIRONMENT: 'synthetic',
      CORRIDRA_CUSTOMER_CODE_SIGNIN: 'true',
      APP_ORIGIN: sampleOrigin,
    },
  });
  try {
    await expect(async () => {
      expect((await page.request.get(sampleOrigin + '/plan')).status()).toBe(200);
    }).toPass({ timeout: 30000 });
    await page.goto(sampleOrigin + '/plan');
    await expect(page.locator('#receipt-check')).toBeVisible();
    await expect(page.getByRole('link', { name: label })).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  } finally {
    next.kill('SIGTERM');
  }
});
