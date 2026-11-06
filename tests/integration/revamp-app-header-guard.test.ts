import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

// CX PR 1 guard (docs/revamp/specs/customer-experience.md, ordered by S1): the customer header changes
// inside AppHeader behind kind === 'customer'. The team and contributor headers must come out byte for
// byte as they did before. Their markup was captured from main before the customer change and is pinned
// in tests/integration/fixtures/app-header-markup.json. To record it again, a person sets
// RECORD_APP_HEADER=1 on purpose; an ordinary run only compares. The two team entries were recorded again
// for the team Today redesign (owner, 6 Nov 2026: "today page redesign"): the inbox as an icon with its
// unread count and the language and website in an account menu. All four entries were recorded again for
// the brand identity (owner, 6 Nov 2026, ADR-077): the brand link's text "Corridra" left the header because
// the logo lockup the shell passes in now carries the drawn wordmark; the link keeps its aria-label. The two team
// entries were recorded again for Navigation v1 (owner, 6 Nov 2026): the Search button, the grouped notifications
// panel, the language menu, the help menu and the avatar menu (docs/revamp/specs/navigation-v1.md, UtilityMenus).
// The contributor entries are unchanged.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  t: unknown,
  p?: unknown,
  ...c: unknown[]
) => unknown;
const renderToStaticMarkup = web('react-dom/server').renderToStaticMarkup as (e: unknown) => string;
const fixture = resolve('tests/integration/fixtures/app-header-markup.json');

const cases = [
  { name: 'team, preview, inbox on', kind: 'team', live: false, notifications: true },
  { name: 'team, live, inbox off', kind: 'team', live: true, notifications: false },
  { name: 'contributor, inbox on', kind: 'contributor', live: false, notifications: true },
  { name: 'contributor, inbox off', kind: 'contributor', live: false, notifications: false },
] as const;

async function render(props: { kind: string; live: boolean; notifications: boolean }) {
  const path = '../../apps/web/components/ux/app-header';
  const { AppHeader } = await import(/* @vite-ignore */ path);
  return renderToStaticMarkup(createElement(AppHeader, props));
}

describe('AppHeader for the team and contributor shells', () => {
  test.each(cases)('$name is byte for byte as before', async ({ name, ...props }) => {
    const markup = await render(props);
    if (process.env.RECORD_APP_HEADER === '1') {
      const old = existsSync(fixture) ? JSON.parse(readFileSync(fixture, 'utf8')) : {};
      writeFileSync(fixture, JSON.stringify({ ...old, [name]: markup }, null, 2) + '\n');
    }
    const pinned = JSON.parse(readFileSync(fixture, 'utf8')) as Record<string, string>;
    expect(markup).toBe(pinned[name]);
    expect(markup).not.toMatch(/customer/i);
  });
});
