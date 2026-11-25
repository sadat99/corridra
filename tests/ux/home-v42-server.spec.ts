import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Home page v4.2 with CORRIDRA_UX_HOME_V42 exactly "true", as the server sends it (G64 request, 25 Nov 2026). The switch
// is read when the page is built, and the shared UX server is built with it unset, so this spec builds the switch-on app
// beside it (`.next/home-v42`, through CORRIDRA_NEXT_DIST_DIR) and serves that build on its own port. It reads the server
// HTML with no script run: the v4.2 markup must be in it and a stylesheet linked from it must hold the v4.2 rules. A
// composition loaded only in the browser (`ssr: false`) or a stylesheet that arrives after the first paint fails here.
const web = resolve('apps/web');
const distDir = '.next/home-v42';
const port = 3191;
const origin = `http://127.0.0.1:${port}`;
let server: ChildProcess | undefined;

async function run(args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn('pnpm', ['exec', 'next', ...args], { cwd: web, env, stdio: 'inherit' });
  const [code] = (await once(child, 'exit')) as [number | null];
  if (code !== 0) throw new Error(`next ${args.join(' ')} exited ${code}`);
}

test.beforeAll(async () => {
  test.setTimeout(900_000);
  const env = {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: '1',
    CORRIDRA_UX_HOME_V42: 'true',
    CORRIDRA_NEXT_DIST_DIR: distDir,
  };
  // `next build` adds its output's type folder to the app's tsconfig.json; that file is tracked, so it is put back.
  const tsconfig = resolve(web, 'tsconfig.json');
  const kept = readFileSync(tsconfig, 'utf8');
  try {
    await run(['build'], env);
  } finally {
    writeFileSync(tsconfig, kept);
  }
  server = spawn(
    'pnpm',
    ['exec', 'next', 'start', '--hostname', '127.0.0.1', '--port', `${port}`],
    {
      cwd: web,
      env,
      stdio: 'ignore',
    },
  );
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(origin + '/')).ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error('the switch-on server did not start');
    await new Promise((done) => setTimeout(done, 500));
  }
});
test.afterAll(() => {
  server?.kill();
});

test('with the switch on the server HTML holds the v4.2 home and links a stylesheet with its rules', async ({
  request,
}) => {
  const response = await request.get(origin + '/');
  expect(response.ok()).toBe(true);
  const html = await response.text();
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  // The composition itself, not a loading placeholder: its classes and its heading are in the HTML.
  expect(main).toMatch(/class="[^"]*\bhv42/);
  expect(main).toContain('<h1 id="home-title">');
  expect(main).not.toContain('BAILOUT_TO_CLIENT_SIDE_RENDERING');
  const sheets = [...html.matchAll(/<link[^>]+href="([^"]+\.css[^"]*)"/g)].map((m) => m[1]!);
  expect(sheets.length).toBeGreaterThan(0);
  const holds: string[] = [];
  for (const sheet of sheets) {
    const css = await (await request.get(new URL(sheet, origin).href)).text();
    if (css.includes('.hv42')) holds.push(sheet);
  }
  expect(
    holds.length,
    'a stylesheet linked from the server HTML holds the v4.2 rules',
  ).toBeGreaterThan(0);
});
