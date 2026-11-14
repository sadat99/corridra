import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// UI/UX.v3 consistency pass, unit A2: the shared page frame (apps/web/components/ux/page-frame.tsx) and its slots in the
// shared WorkspaceShell. Each case fails on the code before this change (the slots, the `framed` prop and the module do
// not exist there). No browser and no database.
const loadWeb = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...children: unknown[]
) => unknown;
const render = web('react-dom/server').renderToStaticMarkup as (element: unknown) => string;

// WorkspaceShell exactly as it stood on main before the slots were added (the staff pages render through it).
function legacyShell(p: {
  eyebrow?: string;
  title: string;
  compact?: boolean;
  className?: string;
  nav?: unknown;
  notice?: unknown;
  customer?: boolean;
  children?: unknown;
}) {
  return createElement(
    'main',
    {
      id: 'main',
      lang: 'en',
      dir: 'ltr',
      tabIndex: -1,
      className: `operator-page ux-workspace${p.compact ? ' ux-access' : ''}${p.nav || p.customer ? ' ux-customer' : ''} ${p.className ?? ''}`,
    },
    createElement(
      'header',
      { className: 'ux-page-heading' },
      p.eyebrow ? createElement('p', { className: 'label' }, p.eyebrow) : null,
      createElement('h1', null, p.title),
    ),
    p.notice,
    p.nav,
    p.children,
  );
}

describe('WorkspaceShell slots', () => {
  it('draws exactly what it drew before when no frame content is passed (staff pages unchanged)', async () => {
    const { WorkspaceShell } = await loadWeb('components/workspace-shell');
    const staff = {
      eyebrow: 'TEAM',
      title: 'Today',
      compact: true,
      className: 'ux-operator-home',
      notice: createElement('p', { className: 'ux-testmode' }, 'Notice'),
      nav: createElement('nav', null, 'Tabs'),
      children: createElement('section', null, 'Body'),
    };
    expect(render(createElement(WorkspaceShell, staff))).toBe(render(legacyShell(staff)));
    const customer = { title: 'Page', customer: true, children: createElement('p', null, 'x') };
    expect(render(createElement(WorkspaceShell, customer))).toBe(render(legacyShell(customer)));
  });

  it('puts the back link and chips above the title and the helper and primary action under it', async () => {
    const { WorkspaceShell } = await loadWeb('components/workspace-shell');
    const { pageFrameSlots } = await loadWeb('components/ux/page-frame');
    const slots = pageFrameSlots({
      back: { label: 'Back to my account', href: '/account' },
      chips: [{ label: 'Planning record only', tone: 'waiting' }],
      helper: 'One line of help.',
      primary: createElement('a', { className: 'primary-link', href: '/go' }, 'Go Now'),
      tabs: createElement('nav', { 'aria-label': 'Sections' }, 'Tabs'),
    });
    const html = render(
      createElement(
        WorkspaceShell,
        { title: 'Page', customer: true, above: slots.above, lead: slots.lead, nav: slots.tabs },
        createElement('p', null, 'Body'),
      ),
    );
    const at = (needle: string) => html.indexOf(needle);
    expect(at('Back to my account')).toBeGreaterThan(-1);
    expect(at('Back to my account')).toBeLessThan(at('<h1>'));
    expect(at('Planning record only')).toBeLessThan(at('<h1>'));
    expect(at('<h1>')).toBeLessThan(at('One line of help.'));
    expect(at('One line of help.')).toBeLessThan(at('Go Now'));
    expect(at('Go Now')).toBeLessThan(at('Tabs'));
    expect(at('Tabs')).toBeLessThan(at('Body'));
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html.match(/primary-link/g)).toHaveLength(1);
  });

  it('draws nothing for an empty frame', async () => {
    const { pageFrameSlots, PageFrameAbove, PageFrameLead } = await loadWeb(
      'components/ux/page-frame',
    );
    expect(pageFrameSlots(undefined)).toEqual({ above: null, lead: null, tabs: null });
    expect(render(createElement(PageFrameAbove, {}))).toBe('');
    expect(render(createElement(PageFrameLead, {}))).toBe('');
  });
});

describe('sections that hand their back link and helper line to the frame', () => {
  it('Delegation registrations: its own back link and sentence go away when framed, and stay when not', async () => {
    const { ParticipantAccount } = await loadWeb('app/account/delegations/participant-account');
    const props = { subject: 's', issuer: 'https://issuer.test' };
    const alone = render(createElement(ParticipantAccount, props));
    const framed = render(createElement(ParticipantAccount, { ...props, framed: true }));
    expect(alone).toContain('Back to my account');
    expect(alone).toContain('An invitation');
    expect(framed).not.toContain('Back to my account');
    expect(framed).not.toContain('An invitation');
  });

  it('the saved request: the same, and the words stay one constant for the page and the section', async () => {
    const { CustomerRequestDetail } = await loadWeb('app/account/requests/request-detail');
    const { savedRequestBack, savedRequestHelper } = await loadWeb('app/account/frame-copy');
    const props = { requestId: 'r1', subject: 's', issuer: 'https://issuer.test' };
    const alone = render(createElement(CustomerRequestDetail, props));
    const framed = render(createElement(CustomerRequestDetail, { ...props, framed: true }));
    expect(alone).toContain(savedRequestBack.label);
    expect(alone).toContain(savedRequestHelper);
    expect(framed).not.toContain(savedRequestBack.label);
    expect(framed).not.toContain(savedRequestHelper);
    expect(savedRequestBack.href).toBe('/account#customer-requests');
  });
});

describe('fee schedule row actions', () => {
  it('keeps Edit in view and sends Retire to a menu named for the record', async () => {
    const { FeeScheduleActions } = await loadWeb('app/account/delegations/fee-schedule-actions');
    const html = render(
      createElement(FeeScheduleActions, {
        name: 'Sample trip fees',
        retired: false,
        busy: false,
        onEdit: () => {},
        onToggleRetired: () => {},
      }),
    );
    expect(html).toContain('Edit Fee Schedule Sample trip fees');
    expect(html).toContain('aria-label="More actions for Sample trip fees"');
    // The menu is closed, so Retire is not on the page until it is opened.
    expect(html).not.toContain('Retire Fee Schedule');
  });
});
