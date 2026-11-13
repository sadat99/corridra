import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The organiser entry on /trade-missions (ADR-080 front door). The page is rendered as the server renders it, once
// with the programme pages switch on and once with it off. The team request stays the first option in both.
const web = createRequire(resolve('apps/web/package.json'));
const ce = web('react').createElement as (type: unknown, props?: unknown) => unknown;
const render = web('react-dom/server').renderToStaticMarkup as (element: unknown) => string;
const view = 'app/trade-missions/page';
const load = async () =>
  (await import(/* @vite-ignore */ `../../apps/web/${view}`)) as {
    default: () => unknown;
    dynamic: string;
  };

// The whole chain the helper checks: workspaces, programmes and participants, then the programme pages switch.
const chain = {
  VERCEL_ENV: 'preview',
  DATA_ENVIRONMENT: 'synthetic',
  CORRIDRA_CUSTOMER_WORKSPACES_ENABLED: 'true',
  CORRIDRA_CUSTOMER_PROGRAMMES_ENABLED: 'true',
  CORRIDRA_CUSTOMER_PARTICIPANTS_ENABLED: 'true',
};
const on = { ...chain, CORRIDRA_PROGRAMME_PAGES: 'true' };
const names = [...Object.keys(on)];
async function html(env: Record<string, string>) {
  vi.resetModules();
  for (const key of names) delete process.env[key];
  Object.assign(process.env, env);
  const page = await load();
  return render(ce(page.default));
}

afterEach(() => {
  for (const key of names) delete process.env[key];
});

describe('/trade-missions organiser entry', () => {
  it('shows the Run your own delegation route with three steps when the switch is on', async () => {
    const out = await html(on);
    expect(out).toContain('Run your own delegation');
    expect(out).toContain('Create the programme');
    expect(out).toContain('Publish its page');
    expect(out).toContain('Review applications');
    expect(out).toMatch(/href="\/account\/delegations\/organise"[^>]*>Open Your Programmes</);
  });

  it('keeps the team request first and unchanged', async () => {
    const out = await html(on);
    const team = out.indexOf('href="/plan?job=delegations"');
    expect(team).toBeGreaterThan(-1);
    expect(team).toBeLessThan(out.indexOf('Run your own delegation'));
    expect(out).toContain('Plan a Trade Mission');
  });

  it('is exactly the page as it was when the switch is off', async () => {
    const off = await html({});
    expect(off).not.toContain('organise-entry');
    expect(off).not.toContain('/account/delegations');
    expect(off).not.toContain('Open Your Programmes');
    // The programme pages switch alone, without the participant chain under it, keeps it off.
    expect(await html({ CORRIDRA_PROGRAMME_PAGES: 'true' })).toBe(off);
    expect(await html(chain)).toBe(off);
  });

  it('reads the switch per request, not at build time', async () => {
    expect((await load()).dynamic).toBe('force-dynamic');
  });

  it('uses no em dash in the new words', async () => {
    const out = await html(on);
    expect(out.slice(out.indexOf('organise-entry'))).not.toMatch(/[—–]/);
  });
});
