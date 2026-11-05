import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixture } from '../integration/support';
import { MissionService } from '../../packages/missions/src/index';
import { configureSyntheticIntake } from '../../packages/missions/src/bootstrap';
// Actual form -> isolated HTTP fixture -> existing service/RLS -> PostgreSQL. Provider identity is a fixture.
const original = '2030-07-15T04:15:30.123Z',
  selected = '2030-07-15T05:30:00.000Z';
let f: Awaited<ReturnType<typeof fixture>>, service: MissionService, server: Server, origin: string;
let scenario: { id: string; mission: unknown; saved: { dueAt: string; version: number }[] };
const oldDataMode = process.env.DATA_ENVIRONMENT;
test.beforeAll(async () => {
  process.env.DATA_ENVIRONMENT = 'synthetic';
  f = await fixture();
  service = new MissionService(f.runtime, 'isolated-date-form-fixture');
  await configureSyntheticIntake(f.owner, f.tenantA, f.users.owner.id);
  const result = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';import {MissionActionForm,missionCommandBody} from ${JSON.stringify(resolve('apps/web/app/operator/missions.tsx'))};const root=createRoot(document.getElementById('fixture'));const data=JSON.parse(document.getElementById('data').textContent);const render=()=>root.render(<MissionActionForm m={data.mission} owners={data.owners} busy={false} onSubmit={async event=>{const input=missionCommandBody(event,data.mission,message=>document.getElementById('status').textContent=message);if(!input)return;const response=await fetch('/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});if(!response.ok){document.getElementById('status').textContent='Command failed: '+response.status;return;}const saved=await response.json();data.mission=saved.mission;render();}}/>);render();`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
    metafile: true,
  });
  expect(Object.keys(result.metafile!.inputs).some((p) => p.includes('packages/auth/src'))).toBe(
    false,
  );
  server = createServer((request, response) => {
    void (async () => {
      response.setHeader('Cache-Control', 'no-store');
      if (request.url === '/fixture.js') {
        response.setHeader('Content-Type', 'text/javascript');
        response.end(result.outputFiles[0].text);
        return;
      }
      if (request.url === '/command' && request.method === 'POST') {
        let body = '';
        for await (const bytes of request) {
          body += bytes;
          if (body.length > 16000) throw Error('Fixture body limit');
        }
        const outcome = await service.command(f.users.owner.ctx, JSON.parse(body));
        const row = (
          await f.owner.query('SELECT due_at FROM app.mission WHERE id=$1', [scenario.id])
        ).rows[0];
        scenario.saved.push({ dueAt: row.due_at.toISOString(), version: outcome.version });
        scenario.mission = (await service.queue(f.users.owner.ctx)).missions.find(
          (m) => m.id === scenario.id,
        )!;
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ mission: scenario.mission }));
        return;
      }
      const data = JSON.stringify({
        mission: scenario.mission,
        owners: [{ user_id: f.users.owner.id, name: 'Synthetic owner', role: 'owner' }],
      }).replace(/</g, '\\u003c');
      response.setHeader('Content-Type', 'text/html');
      response.end(
        `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main><h1>Synthetic date form protocol</h1><div id="fixture"></div><p id="status" role="status"></p></main><script type="application/json" id="data">${data}</script><script type="module" src="/fixture.js"></script></body></html>`,
      );
    })().catch(() => {
      response.statusCode = 400;
      response.end('Isolated command refused');
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Fixture address missing');
  origin = 'http://127.0.0.1:' + address.port;
});
test.afterAll(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>((done) => server.close(() => done()));
  await f?.close();
  if (oldDataMode === undefined) delete process.env.DATA_ENVIRONMENT;
  else process.env.DATA_ENVIRONMENT = oldDataMode;
});
for (const [zone, wall, edited, zoneName] of [
  ['UTC', '04:15', '05:30', 'UTC'],
  ['Asia/Dhaka', '10:15', '11:30', 'Dhaka'],
  ['Asia/Kathmandu', '10:00', '11:15', 'Kath?mandu'],
  ['Europe/Madrid', '06:15', '07:30', 'Madrid'],
]) {
  test(`GAP-009 mission ${zone} preserves the exact unchanged and edited database instant`, async ({
    browser,
  }) => {
    const created = await service.submit(randomUUID(), {
      objective: 'Sell in a New Market',
      market: 'Spain',
      attendance: 'Yes',
      startDate: '2026-11-01',
      endDate: '2026-11-07',
      timezone: 'Europe/Madrid',
      offer: 'Synthetic date fixture ' + randomUUID(),
      website: 'https://example.invalid/catalogue',
      outcomes: ['Relevant meetings'],
      notes: 'Synthetic timezone acceptance',
      name: 'Synthetic owner',
      company: 'Synthetic date company',
      email: 'date-fixture@example.invalid',
      acknowledged: true,
    });
    const seed = {
      id: created.id,
      version: 1,
      action: 'assign',
      commandId: randomUUID(),
      reason: 'Synthetic exact date fixture',
      ownerId: f.users.owner.id,
      nextAction: 'Review the sourced customer requirement',
      dueAt: original,
      marketCode: 'ES',
      targetProfile: 'Synthetic hospitality distributors',
    };
    await service.command(f.users.owner.ctx, seed);
    scenario = {
      id: created.id!,
      mission: (await service.queue(f.users.owner.ctx)).missions.find((m) => m.id === created.id)!,
      saved: [],
    };
    const context = await browser.newContext({ timezoneId: zone });
    try {
      const page = await context.newPage();
      await page.goto(origin);
      const input = page.locator('input[type="datetime-local"]');
      await expect(input).toHaveValue('2030-07-15T' + wall);
      await expect(page.getByText(new RegExp('Time zone:.*' + zoneName))).toBeVisible();
      await page.locator('textarea[name="reason"]').fill('Synthetic unchanged exact instant');
      await page.getByRole('button', { name: 'Save mission action', exact: true }).click();
      await expect.poll(() => scenario.saved.length).toBe(1);
      expect(scenario.saved[0].dueAt).toBe(original);
      await expect(page.locator('textarea[name="reason"]')).toHaveValue('');
      await input.fill('2030-07-15T' + edited);
      await page.locator('textarea[name="reason"]').fill('Synthetic selected exact instant');
      await page.getByRole('button', { name: 'Save mission action', exact: true }).click();
      await expect.poll(() => scenario.saved.length).toBe(2);
      expect(scenario.saved[1].dueAt).toBe(selected);
    } finally {
      await context.close();
    }
  });
}
