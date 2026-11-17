import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// ADR-086. The My Profile panel on the account Profile tab. While customer workspaces are off the page passes
// detailsEnabled=false, and the panel is the read-only card it replaced: the verified email and the name, no loading
// line, no personal details rows and no name edit, so nothing asks /api/customer-personal-profile. The browser check of
// the same state (no request at all) is tests/e2e/verification/revamp-s2/account-profile.spec.ts.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (type: unknown, props?: unknown) => unknown;
const renderToStaticMarkup = web('react-dom/server').renderToStaticMarkup as (
  element: unknown,
) => string;

describe('the account page mounts My Profile with the workspaces switch', () => {
  const page = readFileSync(resolve('apps/web/app/account/page.tsx'), 'utf8');
  const element = page.slice(
    page.indexOf('<PersonalProfile'),
    page.indexOf('/>', page.indexOf('<PersonalProfile')),
  );
  it('passes detailsEnabled from customerWorkspacesEnabled() and the name edit from the capability', () => {
    expect(element).toContain('detailsEnabled={customerWorkspacesEnabled()}');
    expect(element).toContain('nameEditable={accountSecurityCapabilities.updateName}');
    expect(page).toContain(
      "import { customerWorkspacesEnabled } from '@corridra/auth/customer-workspaces';",
    );
  });
});

describe('the panel with details off', () => {
  const props = {
    subject: 'user-1',
    issuer: 'https://auth.example',
    name: 'Amina Rahman',
    email: 'amina@example.test',
  };
  const render = async (over: Record<string, unknown>) => {
    const { PersonalProfile } = await import('../../apps/web/app/account/personal-profile');
    return renderToStaticMarkup(createElement(PersonalProfile, { ...props, ...over }));
  };

  it('shows the verified email and name only, with no loading line, no detail rows and no name edit', async () => {
    const html = await render({ detailsEnabled: false, nameEditable: true });
    expect(html).toContain('Verified account email');
    expect(html).toContain('amina@example.test');
    expect(html).toContain('Amina Rahman');
    expect(html).toContain('Your email address is verified. This does not verify your company.');
    for (const absent of [
      'Loading your details',
      'Edit Name',
      'Your name',
      'About you',
      'Interests',
      'How to reach you',
      'could not be loaded',
      'not available yet',
    ])
      expect(html, absent).not.toContain(absent);
  });

  it('with details on it starts loading them, so the off state above is the switch and nothing else', async () => {
    const html = await render({ detailsEnabled: true, nameEditable: false });
    expect(html).toContain('Loading your details');
  });
});
