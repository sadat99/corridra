import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// The teaching layer (Lane 1 of the UX update): the Road, the holder badge, the Move card, the quote
// card, the ghost state and the mode label. Pure presentation over data the app already holds. No
// production route imports these yet; every rule here is checked without a browser or a database.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...children: unknown[]
) => unknown;
const renderToStaticMarkup = web('react-dom/server').renderToStaticMarkup as (
  element: unknown,
) => string;
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: unknown;
    href: string;
    className?: string;
  }) => createElement('a', { href, className }, children as never),
}));

// The modules are TSX files; the package type check has no JSX setting, so they are loaded by path.
const dir = '../../apps/web/components/mr';
const load = async (name: string) => await import(/* @vite-ignore */ `${dir}/${name}`);
const render = (type: unknown, props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(type, props));

const { missionStatus } = (await import('../../packages/domain/src/missions')) as {
  missionStatus: { options: readonly string[] };
};

describe('the Road mapping', () => {
  it('maps every mission status the domain defines, so a new status cannot slip through unmapped', async () => {
    const { statusToRoadStep } = await load('road-status');
    for (const status of missionStatus.options) {
      const marker = statusToRoadStep(status);
      expect(
        marker.kind === 'marker' || ['on_hold', 'cancelled'].includes(marker.reason),
        status,
      ).toBe(true);
    }
  });

  it('puts each status on the step the plan names', async () => {
    const { statusToRoadStep } = await load('road-status');
    const step = (s: string) => {
      const marker = statusToRoadStep(s);
      return marker.kind === 'marker' ? marker.step : marker.reason;
    };
    expect(['DRAFT', 'QUALIFICATION'].map(step)).toEqual(['define', 'define']);
    expect(['ACTIVE', 'TARGETING', 'OUTREACH'].map(step)).toEqual(['find', 'find', 'find']);
    expect(step('MEETINGS')).toBe('visit');
    expect(['FOLLOW_UP', 'COMMERCIAL_PIPELINE', 'CLOSED'].map(step)).toEqual([
      'follow',
      'follow',
      'follow',
    ]);
    expect(step('ON_HOLD')).toBe('on_hold');
    expect(step('CANCELLED')).toBe('cancelled');
  });

  it('never invents a step for a status it does not know', async () => {
    const { statusToRoadStep } = await load('road-status');
    for (const status of ['', 'ARCHIVED', 'constructor', '__proto__', 'meetings'])
      expect(statusToRoadStep(status), status).toMatchObject({ kind: 'aside', reason: 'unknown' });
  });

  it('never steps back along the legal transition graph', async () => {
    const { statusToRoadStep, roadMarkerIndex } = await load('road-status');
    // The legal forward moves in packages/missions/src/index.ts (applyMissionCommand).
    const edges: [string, string][] = [
      ['DRAFT', 'QUALIFICATION'],
      ['QUALIFICATION', 'ACTIVE'],
      ['ACTIVE', 'TARGETING'],
      ['TARGETING', 'OUTREACH'],
      ['OUTREACH', 'MEETINGS'],
      ['MEETINGS', 'FOLLOW_UP'],
      ['FOLLOW_UP', 'COMMERCIAL_PIPELINE'],
      ['ACTIVE', 'COMMERCIAL_PIPELINE'],
      ['TARGETING', 'COMMERCIAL_PIPELINE'],
      ['COMMERCIAL_PIPELINE', 'CLOSED'],
    ];
    for (const [from, to] of edges)
      expect(roadMarkerIndex(statusToRoadStep(to)), `${from} to ${to}`).toBeGreaterThanOrEqual(
        roadMarkerIndex(statusToRoadStep(from)),
      );
  });

  it('lights Compare and Decide only from records, never from the status', async () => {
    const { statusToRoadStep, roadStates } = await load('road-status');
    const none = { compare: false, decide: false };
    for (const status of missionStatus.options) {
      const s = roadStates(statusToRoadStep(status), none);
      expect(s.compare, status).toBe('notTracked');
      expect(s.decide, status).toBe('notTracked');
    }
    const lit = roadStates(statusToRoadStep('MEETINGS'), { compare: true, decide: false });
    expect(lit).toMatchObject({
      define: 'done',
      find: 'done',
      compare: 'done',
      visit: 'now',
      decide: 'notTracked',
      follow: 'later',
    });
  });

  it('marks nothing as now or done when the request is paused, cancelled or unknown', async () => {
    const { statusToRoadStep, roadStates } = await load('road-status');
    for (const status of ['ON_HOLD', 'CANCELLED', 'ARCHIVED']) {
      const s = roadStates(statusToRoadStep(status), { compare: false, decide: false });
      expect(Object.values(s).includes('now'), status).toBe(false);
      expect(s.define, status).toBe('later');
    }
  });
});

describe('the Road', () => {
  it('is an ordered list with the current step announced and a word under every step', async () => {
    const { Road } = await load('road');
    const html = render(Road, { status: 'MEETINGS', records: { compare: true, decide: false } });
    expect(html).toContain('<ol');
    expect(html.match(/<li/g)).toHaveLength(6);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    for (const word of ['Define', 'Find', 'Compare', 'Visit', 'Decide', 'Follow through'])
      expect(html).toContain(`<b>${word}</b>`);
    for (const state of ['Done', 'Now', 'Later', 'Not tracked yet'])
      expect(html).toContain(`>${state}<`);
    expect(html).toContain('Meetings are being arranged or held.');
  });

  it('says plainly when a request is on hold and shows no current step', async () => {
    const { Road } = await load('road');
    const html = render(Road, { status: 'ON_HOLD' });
    expect(html).toContain('On hold. The Corridra team has paused this request.');
    expect(html).not.toContain('aria-current');
  });

  it('shows an unknown status as a plain line and no marker', async () => {
    const { Road } = await load('road');
    const html = render(Road, { status: 'IN_REVIEW' });
    expect(html).toContain('Status: in review');
    expect(html).not.toContain('aria-current');
  });

  it('uses translated words when they are passed in, and keeps long words whole', async () => {
    const { Road } = await load('road');
    const { mrLabels } = await load('labels');
    const longer = (s: string) => s + ' ' + s.slice(0, Math.ceil(s.length * 0.4));
    const steps = Object.fromEntries(
      Object.entries(mrLabels.road.steps).map(([k, v]) => [k, longer(v as string)]),
    );
    const html = render(Road, { status: 'ACTIVE', labels: { ...mrLabels.road, steps } });
    for (const v of Object.values(steps)) expect(html).toContain(v as string);
  });
});

describe('the holder badge', () => {
  it('always shows the word and a fixed shape for each of the three holders', async () => {
    const { HolderBadge } = await load('holder-badge');
    for (const [holder, word] of [
      ['you', 'You'],
      ['team', 'Corridra team'],
      ['third', 'Supplier or Buyer'],
    ] as const) {
      const html = render(HolderBadge, { holder });
      expect(html).toContain(`data-holder="${holder}"`);
      expect(html).toContain(word);
      expect(html).toContain('aria-hidden="true"');
    }
  });
});

describe('the Move card', () => {
  it('reads as one verb, one object and one holder, and shows a date only when a real one is passed', async () => {
    const { MoveCard } = await load('move-card');
    const base = { verb: 'Add', object: 'your import licence number', holder: 'you' };
    const without = render(MoveCard, base);
    expect(without).toContain('Add your import licence number');
    expect(without).not.toContain('Due');
    expect(without).not.toContain('<time');
    const withDate = render(MoveCard, { ...base, due: '5 November 2026' });
    expect(withDate).toContain('Due <time>5 November 2026</time>');
  });

  it('draws an action only when the holder can take it', async () => {
    const { MoveCard } = await load('move-card');
    const base = { verb: 'Answer', object: 'the evidence request', holder: 'team' };
    expect(render(MoveCard, base)).not.toMatch(/<a[ >]/);
    const withAction = render(MoveCard, {
      ...base,
      holder: 'you',
      href: '/account',
      action: 'Answer',
    });
    expect(withAction).toContain('href="/account"');
  });

  it('offers only the fixed list of verbs', async () => {
    const { moveVerbs } = await load('move-card');
    expect([...moveVerbs]).toEqual(['Read', 'Answer', 'Add', 'Confirm', 'Choose', 'Send']);
  });
});

describe('the quote card', () => {
  const terms = [
    { label: 'Lead time', value: '45 days' },
    { label: 'Installation', value: undefined },
    { label: 'Spares', value: '' },
  ];

  it('shows a filled seal and the words only when the engine says comparable', async () => {
    const { QuoteCard } = await load('quote-card');
    const ok = render(QuoteCard, {
      supplier: 'Lantern',
      revision: 2,
      currency: 'USD',
      comparable: true,
      terms,
    });
    expect(ok).toContain('Comparable on supplied terms');
    expect(ok).toContain('✓');
    const no = render(QuoteCard, {
      supplier: 'Verde',
      revision: 1,
      currency: 'CNY',
      comparable: false,
      reason: 'Missing: Installation',
      terms,
    });
    expect(no).toContain('Not comparable yet');
    expect(no).toContain('Missing: Installation');
    expect(no).not.toContain('✓');
  });

  it('shows a missing term as Not stated, never as zero, and keeps the original currency and trust label', async () => {
    const { QuoteCard } = await load('quote-card');
    const html = render(QuoteCard, {
      supplier: 'Verde',
      revision: 1,
      currency: 'CNY',
      unitPrice: 'CNY 128,000.00',
      comparable: false,
      terms,
    });
    expect(html.match(/Not stated/g)!.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain('CNY 128,000.00');
    expect(html).toContain('Self-declared');
    expect(html).not.toMatch(/>0(\.00)?</);
  });

  it('marks a supplier name in another language so it is read in that language', async () => {
    const { QuoteCard } = await load('quote-card');
    const html = render(QuoteCard, {
      supplier: '绿野机械有限公司',
      supplierLang: 'zh',
      revision: 1,
      currency: 'CNY',
      comparable: false,
      terms,
    });
    expect(html).toContain('<h3 lang="zh">绿野机械有限公司</h3>');
  });
});

describe('the ghost state and the mode label', () => {
  it('hides the example from assistive technology and tags it', async () => {
    const { GhostState } = await load('ghost-state');
    const html = render(GhostState, {
      title: 'Nothing here yet',
      text: 'Your offers will appear here.',
    }) as string;
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('inert');
    expect(html).toContain('Example');
  });

  it('says Sample or Real once, with the word', async () => {
    const { ModeLabel } = await load('mode-label');
    expect(render(ModeLabel, { real: false })).toContain('>Sample<');
    expect(render(ModeLabel, { real: true })).toContain('>Real<');
  });
});

describe('the stylesheets of the teaching layer', () => {
  const root = resolve('apps/web/components/mr');
  const files = readdirSync(root).filter((f) => f.endsWith('.css'));

  it('use only existing tokens: no hex colour and no new custom property', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const css = readFileSync(resolve(root, file), 'utf8');
      expect(css, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(css, file).not.toMatch(/^\s*--[a-z-]+\s*:/m);
    }
  });

  it('keep motion to the shared duration and never below the 12 px text floor', () => {
    for (const file of files) {
      const css = readFileSync(resolve(root, file), 'utf8');
      for (const m of css.matchAll(/transition[^;]*?(\d+(?:\.\d+)?)ms/g))
        expect(Number(m[1]), file).toBeLessThanOrEqual(220);
      for (const m of css.matchAll(/font-size:\s*(\d*\.?\d+)px/g))
        expect(Number(m[1]), file).toBeGreaterThanOrEqual(12);
    }
  });

  it('are imported by their component and only by the screens that mount them', () => {
    const app = resolve('apps/web/app');
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(resolve(d, e.name)) : [resolve(d, e.name)],
      );
    // Each lane that mounts the layer adds its screen here, in the same pull request that builds it.
    const mounts = [
      'app/account/move/move-view.tsx',
      'app/account/rooms/[requestId]/room-view.tsx',
    ];
    const importers = walk(app)
      .filter((f) => /\.(tsx?|css)$/.test(f))
      .filter((f) => /components\/mr\b/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(resolve('apps/web').length + 1));
    expect(importers.sort()).toEqual(mounts.sort());
  });
});
