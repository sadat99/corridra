import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { WorkItem, WorkList } from '../../apps/web/lib/work-items/types';

// CX PR 2a, Home (docs/revamp/specs/customer-experience.md): the one next step as a single row with no second
// primary action and no mono-capital label, up to five active-work rows that are each one link, and a slim
// six-segment stage bar for the newest request where a stage with no data is plain grey and never says
// "not tracked yet". Case ids: CX-01 (content kept short), CX-06, CX-02 (the links stay).
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...children: unknown[]
) => unknown;
const render = web('react-dom/server').renderToStaticMarkup as (element: unknown) => string;
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
vi.mock('../../apps/web/lib/foundations', () => ({ foundations: () => null }));
const load = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const W = '11111111-1111-4111-8111-111111111111';
const item = (n: number, extra: Partial<WorkItem> = {}): WorkItem => ({
  key: `request:${id(n)}`,
  kind: 'request',
  id: id(n),
  workspaceId: W,
  family: 'SELL',
  title: `Request ${n}`,
  status: 'MEETINGS',
  at: '2026-11-04T10:00:00.000Z',
  atKind: 'updated',
  href: `/account/requests/${id(n)}`,
  ...extra,
});
const list = (items: WorkItem[], extra: Partial<WorkList> = {}): WorkList => ({
  items,
  unreadable: [],
  partial: false,
  skippedWorkspaces: 0,
  workspaces: [{ id: W, name: 'Atelier Rahman' }],
  ...extra,
});

describe('CX PR 2a: the stage bar', () => {
  it('draws six segments, marks the current one, and keeps a stage with no data plain grey with no words', async () => {
    const { StageBar } = await load('components/mr/stage-bar.tsx');
    const html = render(createElement(StageBar, { status: 'MEETINGS' }));
    expect(html.match(/<li /g)).toHaveLength(6);
    expect(html).toContain('aria-current="step"');
    expect(html).toMatch(/data-state="done"/);
    expect(html).toMatch(/data-state="later"/);
    // Compare and Decide have no record here: plain grey, and the words never appear.
    expect(html).toMatch(/data-state="grey"/);
    expect(html.toLowerCase()).not.toContain('not tracked');
    expect(html).toContain('Stage:');
  });
  it('says a paused or unknown request has no stage instead of guessing one', async () => {
    const { StageBar } = await load('components/mr/stage-bar.tsx');
    const html = render(createElement(StageBar, { status: 'ON_HOLD' }));
    expect(html).not.toContain('aria-current');
    expect(html).not.toMatch(/data-state="done"/);
    expect(html.toLowerCase()).not.toContain('not tracked');
  });
});

describe('CX PR 2a: Active work on Home', () => {
  it('shows at most five rows and each row is exactly one link', async () => {
    const { HomeWorkView } = await load('app/account/home-work.tsx');
    const html = render(
      createElement(HomeWorkView, { list: list([1, 2, 3, 4, 5, 6, 7].map((n) => item(n))) }),
    );
    const rows = html.match(/<li class="ux-row"/g) ?? [];
    expect(rows).toHaveLength(5);
    for (const row of html.split('<li class="ux-row"').slice(1))
      expect(row.split('</li>')[0].match(/<a /g)).toHaveLength(1);
    expect(html).toContain('See all your work');
    expect(html).toContain('href="/account?view=work"');
  });
  it('gives each row its kind, status and updated date as cells, and a calm line when there is nothing', async () => {
    const { HomeWorkView } = await load('app/account/home-work.tsx');
    const html = render(createElement(HomeWorkView, { list: list([item(1)]) }));
    expect(html).toContain('Request 1');
    expect(html).toContain('Kind');
    expect(html).toContain('Status');
    expect(html).toContain('Updated');
    const none = render(createElement(HomeWorkView, { list: list([]) }));
    expect(none).toContain('You have no work here yet.');
    expect(none).not.toContain('<li class="ux-row"');
  });
  it('shows the stage bar for the newest request only', async () => {
    const { HomeWorkView } = await load('app/account/home-work.tsx');
    const html = render(
      createElement(HomeWorkView, {
        list: list([
          item(1, { kind: 'draft', status: 'OPEN' }),
          item(2, { status: 'FOLLOW_UP' }),
          item(3, { status: 'ACTIVE' }),
        ]),
      }),
    );
    expect(html.match(/class="mr-stage"/g)).toHaveLength(1);
    expect(html).toContain('Request 2');
  });
  it('says so when the list could not be read in full, and never shows a stage for nothing', async () => {
    const { HomeWorkView } = await load('app/account/home-work.tsx');
    const html = render(
      createElement(HomeWorkView, {
        list: list([], { unreadable: ['requests'] }),
      }),
    );
    expect(html).toContain('We could not check everything just now.');
    expect(html).not.toContain('mr-stage');
  });
});

describe('CX PR 2a: the next step on Home', () => {
  it('is one row link with a plain heading, no mono-capital label and no second primary button', async () => {
    const { HomeNextStep } = await load('app/account/home-next-step.tsx');
    const html = render(
      createElement(HomeNextStep, {
        title: 'New request',
        text: 'Tell us your goal. It takes a few minutes.',
        href: '/plan',
      }),
    );
    expect(html).toContain('Your next step');
    expect(html).not.toContain('class="label"');
    expect(html).not.toContain('primary-link');
    expect(html).not.toContain('YOUR NEXT STEP');
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('href="/plan"');
  });
});
