import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// UI/UX.v4.1 wave V4.1-C, helper pages: /contributor and the pages under it. Checked without a browser or a
// database. L9: the page a helper opens without a workspace link shows one "next step" card with one primary
// action, and still says that a customer account does not grant task access. A place on a task carries its mark
// (L1). No route, link, sign-in return or access check moves.
const web = createRequire(resolve('apps/web/package.json'));
const ce = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...children: unknown[]
) => unknown;
const render = web('react-dom/server').renderToStaticMarkup as (element: unknown) => string;
const read = (path: string) => readFileSync(resolve(path), 'utf8');
const loadWeb = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
const dashes = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

describe('L9: one next step card with one primary action', () => {
  it('draws a named region with its label, title, line, one primary link and the quiet link given to it', async () => {
    const { NextStep } = await loadWeb('app/contributor/next-step');
    const html = render(
      ce(
        NextStep,
        {
          title: 'Accept an Invitation',
          line: 'Set up your separate access from the invitation you were sent.',
          href: '/contributor/setup',
          action: 'Accept an Invitation',
        },
        ce('a', { className: 'text-link', href: '/contributor/signin' }, 'Helper Sign-In'),
      ),
    );
    expect(html).toMatch(/^<section class="helper-next" aria-labelledby="[^"]+">/);
    expect(html).toContain('<p class="label">Your next step</p>');
    expect(html).toMatch(/<h2 id="[^"]+">Accept an Invitation<\/h2>/);
    expect(html.match(/class="primary-link"/g)).toHaveLength(1);
    expect(html).toMatch(
      /<a class="primary-link" href="\/contributor\/setup">Accept an Invitation<\/a>/,
    );
    expect(html).toContain('<a class="text-link" href="/contributor/signin">Helper Sign-In</a>');
    // The label names the region when there is no title of its own.
    const bare = render(
      ce(NextStep, { href: '/contributor/setup', action: 'Accept a Reviewed Helper Invitation' }),
    );
    expect(bare).not.toContain('<h2');
    expect(bare).toMatch(/<p class="label" id="[^"]+">Your next step<\/p>/);
    expect(bare.match(/class="primary-link"/g)).toHaveLength(1);
  });

  it('the page gives the card the one primary way in, in both switch states, and keeps every other link', () => {
    const page = read('apps/web/app/contributor/page.tsx');
    const flat = page.replace(/\s+/g, ' ');
    expect(page.match(/<NextStep/g)).toHaveLength(2);
    // The primary action is the card's alone: the page writes no second filled action.
    expect(page).not.toContain('className="primary-link"');
    // Switch on: the card takes the primary door, the door list keeps the others.
    expect(flat).toContain('const firstDoor = helperDoor.find((item) => item.primary)');
    expect(flat).toContain(
      '<FrontDoor label="Ways in for a helper" items={helperDoor.filter((item) => !item.primary)} />',
    );
    expect(page.match(/<FrontDoor/g)).toHaveLength(1);
    // Switch off: the same words and addresses as before.
    expect(flat).toContain(
      'href="/contributor/setup" action="Accept a Reviewed Helper Invitation"',
    );
    for (const line of ['How assigned work works', 'Choose your sign-in route', 'Back to Corridra'])
      expect(page).toContain(line);
    expect(page.match(/<a className="text-link" href="\/contributor\/signin">/g)).toHaveLength(2);
    // The page still says it.
    expect(flat).toContain(
      'Open the workspace link supplied with your reviewed invitation. A customer account does not grant assigned-task access.',
    );
    expect(flat.indexOf('A customer account does not grant assigned-task access.')).toBeLessThan(
      flat.indexOf('<NextStep'),
    );
  });

  it('no access check moved', () => {
    const page = read('apps/web/app/contributor/page.tsx');
    expect(page).toContain('if (!s) return <ContributorUnavailable />;');
    expect(page).toContain("redirect(\n      '/contributor/signin?next='");
    expect(page).toContain("process.env.CORRIDRA_NETWORK_ENABLED === 'true'");
    expect(page.indexOf('if (!workspace.success)')).toBeLessThan(page.indexOf('<TaskBoard'));
  });

  it('the card stylesheet uses tokens only', () => {
    const css = read('apps/web/app/contributor/next-step.css');
    expect(css).not.toMatch(
      /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(|gradient|backdrop-filter|text-transform/,
    );
    expect(css).not.toMatch(dashes);
    expect(read('apps/web/app/contributor/next-step.tsx')).not.toMatch(dashes);
  });
});

describe('L2: a helper door carries one owned icon, and every other door list is what it was', () => {
  it('a door without an icon renders the markup it always rendered', async () => {
    const { FrontDoor } = await loadWeb('components/front-door');
    const { founderDoor } = await loadWeb('lib/front-doors');
    expect(founderDoor.some((item: { icon?: string }) => item.icon)).toBe(false);
    const html = render(ce(FrontDoor, { label: 'Founder areas', items: founderDoor }));
    // The markup of main before this unit, written out card by card.
    const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/'/g, '&#x27;');
    const before =
      '<nav class="front-door" aria-label="Founder areas"><ul>' +
      founderDoor
        .map(
          (item: { href: string; title: string; line: string; primary?: boolean }) =>
            `<li><a class="front-door-card"${item.primary ? ' data-primary="true"' : ''} href="${item.href}">` +
            `<b>${esc(item.title)}</b><span>${esc(item.line)}</span></a></li>`,
        )
        .join('') +
      '</ul></nav>';
    expect(html).toBe(before);
    expect(html).not.toContain('front-door-tile');
    expect(html).not.toContain('data-icon');
  });

  it('each helper door names one existing icon, drawn once in a tile hidden from a screen reader', async () => {
    const { FrontDoor } = await loadWeb('components/front-door');
    const { helperDoor } = await loadWeb('lib/front-doors');
    const { iconPaths } = await loadWeb('components/corridra-icon');
    for (const item of helperDoor) expect(Object.keys(iconPaths), item.id).toContain(item.icon);
    const quiet = helperDoor.filter((item: { primary?: boolean }) => !item.primary);
    const html = render(ce(FrontDoor, { label: 'Ways in for a helper', items: quiet }));
    expect(html.match(/<span class="front-door-tile" aria-hidden="true"><svg/g)).toHaveLength(2);
    expect(html.match(/<svg/g)).toHaveLength(2);
    expect(html.match(/data-icon="true"/g)).toHaveLength(2);
    // The words stay beside the icon: never an icon alone.
    for (const item of quiet) expect(html).toContain(`<b>${item.title}</b>`);
    const css = read('apps/web/components/front-door.css');
    expect(css).toMatch(
      /\.front-door-tile \{[^}]*inline-size: 2\.75rem;[^}]*block-size: 2\.75rem;/,
    );
    expect(css).toMatch(/\.front-door-tile \{[^}]*background: var\(--surface-subtle\)/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|gradient|backdrop-filter/);
  });
});

describe('L1: the places of a task carry their mark', () => {
  it('the market and the work country go through the shared flag component with their plain names', () => {
    const board = read('apps/web/app/contributor/task-board.tsx').replace(/\s+/g, ' ');
    expect(board).toContain(
      '<Flagged code={placeMark(task.disclosure.market)}> {place(task.disclosure.market)} </Flagged>',
    );
    expect(board).toContain(
      '<Flagged code={placeMark(task.disclosure.workCountry)}> {place(task.disclosure.workCountry)} </Flagged>',
    );
    // The line keeps its words and its order: state, market, then the work country.
    expect(board).toMatch(
      /\{words\(task\.status\)\} ·\{' '\} <Flagged[^>]*>[^<]*<\/Flagged>\{' '\} · work country\{' '\} <Flagged/,
    );
  });
});

describe('the conformance ledger rows of the helper routes', () => {
  const ledger = JSON.parse(read('docs/revamp/v4-1-conformance.json')) as {
    routes: {
      route: string;
      decisions: Record<string, string>;
      evidence: string[];
      notes: string;
    }[];
  };
  const row = (route: string) => ledger.routes.find((r) => r.route === route)!;
  it('are assessed, and /contributor carries L9, L1 and L2 as built with evidence', () => {
    for (const route of [
      '/contributor',
      '/contributor/me',
      '/contributor/setup',
      '/contributor/signin',
    ]) {
      expect(Object.values(row(route).decisions), route).not.toContain('not_assessed');
      expect(row(route).notes, route).not.toBe('');
      expect(row(route).notes, route).not.toMatch(dashes);
    }
    expect(row('/contributor').decisions.L9).toBe('built');
    expect(row('/contributor').decisions.L1).toBe('built');
    expect(row('/contributor').decisions.L2).toBe('built');
    expect(row('/contributor').evidence.length).toBeGreaterThan(0);
  });
});
