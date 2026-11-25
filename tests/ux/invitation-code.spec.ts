import { expect, test, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Owner walk findings D-041, D-042, D-043, D-044 and D-048 on the invitation code, for the organiser who creates it and
// the participant who types it. The real ProgrammeParticipants and ParticipantAccount and their real stylesheets are
// drawn on a small bundled page inside the customer frame (no sign-in; the participant API is answered by the test), in
// real customer wording. Component protocol fixture, not database acceptance: what the server answers to a wrong code
// is taken from the route (403), not proven here.
const fixturePath = '/__invitation-code-fixture';
const workspaceId = '00000000-0000-4000-8000-000000000001';
const programmeId = '00000000-0000-4000-8000-000000000002';
const invitationId = '00000000-0000-4000-8000-000000000003';
const registrationId = '00000000-0000-4000-8000-000000000004';
const issuer = 'https://ep-ui-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const token = 'a'.repeat(43);
// The shape the owner saw printed raw on the page.
const expiresAt = '2099-11-30T06:21:40.16943+00:00';
const expiresWords = '30 Nov 2099, 12:21 (Dhaka, UTC+6)';
const wrongCode = 'That code is not valid or has expired. Check it and try again.';
const shortCode = 'Enter the full code from your invitation.';
const emailFailed =
  'The email was not sent. Retry the email or copy the code and share it yourself.';
const accessCleared =
  'Your account or programme access could not be confirmed. Previous details were cleared.';
let html = '';

test.use({ timezoneId: 'Asia/Dhaka' });

test.beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import { createRoot } from 'react-dom/client';
        import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
        import { WorkspaceShell } from ${JSON.stringify(resolve('apps/web/components/workspace-shell.tsx'))};
        import { ParticipantAccount } from ${JSON.stringify(resolve('apps/web/app/account/delegations/participant-account.tsx'))};
        import { ProgrammeParticipants } from ${JSON.stringify(resolve('apps/web/app/account/delegations/programme-participants.tsx'))};
        const owner = new URLSearchParams(location.search).get('mode') === 'owner';
        const router = { push: (path) => location.assign(path), replace: (path) => location.replace(path), back: () => history.back(), forward: () => history.forward(), refresh: () => {}, hmrRefresh: () => {}, prefetch: async () => {} };
        createRoot(document.getElementById('app')).render(
          <AppRouterContext.Provider value={router}>
            <WorkspaceShell title="Invitation code fixture" customer>
              <div className="account-compact">
                {owner
                  ? <section><h2>Current programme controls</h2><ProgrammeParticipants subject="synthetic-alice" issuer=${JSON.stringify(issuer)} workspaceId=${JSON.stringify(workspaceId)} programmeId=${JSON.stringify(programmeId)} /></section>
                  : <ParticipantAccount subject="synthetic-alice" issuer=${JSON.stringify(issuer)} />}
              </div>
            </WorkspaceShell>
          </AppRouterContext.Provider>);`,
      loader: 'tsx',
      resolveDir: resolve('apps/web'),
    },
    nodePaths: [resolve('apps/web/node_modules')],
    bundle: true,
    external: ['/flags/*'],
    outdir: 'out',
    loader: { '.css': 'css' },
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    // Next replaces these at build time; the second one turns on the wording a real customer reads.
    define: {
      'process.env.NODE_ENV': '"production"',
      'process.env.NEXT_PUBLIC_CORRIDRA_REAL_USE_ENABLED': '"true"',
      'process.env': '{}',
    },
  });
  const js = bundle.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  const bundled = bundle.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? '';
  const css = [
    readFileSync(resolve('apps/web/app/globals.css'), 'utf8'),
    readFileSync(resolve('apps/web/components/ux/shells.css'), 'utf8'),
    bundled,
  ].join('\n');
  html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Invitation code fixture</title><style>${css}</style></head><body><div class="site-shell"><div id="app"></div></div><script type="module">${js.replace(/<\/script/g, '<\\/script')}</script></body></html>`;
});

const invitation = (n: number) => ({
  id: `00000000-0000-4000-8000-0000000010${String(n).padStart(2, '0')}`,
  label: `Spring buyers group ${n}`,
  expiresAt,
  status: 'ISSUED',
});
const manage = (invitations: unknown[]) => ({
  workspaceId,
  programmeId,
  invitations,
  registrations: [],
  nextInvitationAfter: null,
  nextRegistrationAfter: null,
  synthetic: false,
});
const own = () => ({
  registrations: [
    {
      id: registrationId,
      programmeId,
      name: 'Spring buyers programme',
      reportingPurpose: 'A shared programme purpose with no private commercial details',
      displayLabel: 'Northfield Trading',
      consentedAt: '2026-10-18T00:00:00Z',
      status: 'REGISTERED',
      synthetic: false,
    },
  ],
  nextAfter: null,
  synthetic: false,
});
const issued = () => ({
  id: invitationId,
  programmeId,
  expiresAt,
  issued: true,
  token,
  canEmail: true,
  synthetic: false,
});

const participantsApi = '/api/customer-programme-participants';
async function serve(page: Page, answer: (route: Route) => unknown) {
  await page.route('**' + fixturePath + '*', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.route('**' + participantsApi + '*', answer);
}

/** The organiser creates a code; the list then holds `rows` invitations, so the code sits well down the page. */
async function issueCode(
  page: Page,
  options: { rows?: number; email?: (route: Route) => unknown },
) {
  let created = false;
  await serve(page, async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        json: manage(
          created ? Array.from({ length: options.rows ?? 1 }, (_, n) => invitation(n + 1)) : [],
        ),
      });
    if (route.request().postDataJSON().action === 'emailInvitation') return options.email?.(route);
    created = true;
    return route.fulfill({ json: issued() });
  });
  await page.goto(fixturePath + '?mode=owner');
  await page.getByLabel('Invitation label', { exact: true }).fill('Spring buyers group');
  await page
    .getByLabel('Participant email (optional)', { exact: true })
    .fill('participant@example.test');
  await page.getByRole('checkbox', { name: /permission to share this code/ }).check();
  await page.getByRole('button', { name: 'Create Invitation Code', exact: true }).click();
  // The list is read again after the code is created; the page is settled once its last row is drawn.
  await expect(
    page.getByText(`Spring buyers group ${options.rows ?? 1}`, { exact: true }),
  ).toBeVisible();
  const code = page.getByLabel('Private invitation code', { exact: true });
  await expect(code).toHaveValue(token);
  return code;
}

/** What the page's clipboard does: takes the text, refuses it, or is not there at all (an old or locked-down browser). */
async function clipboard(page: Page, mode: 'works' | 'refuses' | 'absent') {
  await page.addInitScript((kind) => {
    const copied: string[] = [];
    Object.defineProperty(window, '__copied', { value: copied });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value:
        kind === 'absent'
          ? undefined
          : {
              writeText: (text: string) =>
                kind === 'works'
                  ? (copied.push(text), Promise.resolve())
                  : Promise.reject(new Error('refused')),
            },
    });
  }, mode);
}

test.describe('the organiser and the one-time code (D-048)', () => {
  test('Copy Code puts the exact code on the clipboard and says Copied in a polite live region', async ({
    page,
  }) => {
    await clipboard(page, 'works');
    await issueCode(page, {});
    const copy = page.getByRole('button', { name: 'Copy Code', exact: true });
    await expect(copy).toBeVisible();
    await copy.click();
    expect(
      await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied),
    ).toEqual([token]);
    const said = page
      .locator('[role="status"][aria-live="polite"]')
      .filter({ hasText: /^Copied$/ });
    await expect(said).toBeVisible();
    await expect(
      page.getByText('This code is shown once. Copy it now.', { exact: true }),
    ).toBeVisible();
    // What the paragraph already said is still said, once.
    await expect(
      page.getByRole('link', { name: 'Delegation registrations', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/If you entered an email, you can also choose Email Invitation\./),
    ).toBeVisible();
    const section = await page.getByRole('region', { name: 'Programme participants' }).innerText();
    expect(section.match(/shown once/g)).toHaveLength(1);
    expect(section).not.toMatch(/synthetic|sample|draft|operator|scope/i);
    // The button is a full touch target.
    const box = await copy.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  });

  for (const mode of ['refuses', 'absent'] as const)
    test(`when the clipboard ${mode === 'refuses' ? 'refuses' : 'is not there'}, the code is selected and the page says which keys copy it`, async ({
      page,
    }) => {
      await clipboard(page, mode);
      const code = await issueCode(page, {});
      await page.getByRole('button', { name: 'Copy Code', exact: true }).click();
      await expect(
        page
          .locator('[role="status"][aria-live="polite"]')
          .filter({ hasText: 'Press Ctrl+C or Cmd+C to copy.' }),
      ).toBeVisible();
      await expect(code).toBeFocused();
      expect(
        await code.evaluate((input: HTMLInputElement) => [
          input.selectionStart,
          input.selectionEnd,
        ]),
      ).toEqual([0, token.length]);
      await expect(page.getByText('Copied', { exact: true })).toHaveCount(0);
    });

  test('an invitation in the list shows when it expires in words, never as a raw timestamp', async ({
    page,
  }) => {
    await issueCode(page, {});
    await expect(page.getByText(`Invitation available · Expires ${expiresWords}`)).toBeVisible();
  });
});

test.describe('Email Invitation (D-041)', () => {
  test('the result is said beside the button in a polite live region, for a failure and then a success', async ({
    page,
  }) => {
    let emails = 0;
    await issueCode(page, {
      email: (route) =>
        route.fulfill({
          json: {
            id: invitationId,
            programmeId,
            email: ++emails === 1 ? 'not_sent' : 'sent',
            synthetic: false,
          },
        }),
    });
    const button = page.getByRole('button', { name: 'Email Invitation', exact: true });
    const beside = page.locator(
      'button:text-is("Email Invitation") + [role="status"][aria-live="polite"]',
    );
    await button.click();
    await expect(beside).toHaveText(emailFailed);
    // Said once: the same words are not repeated at the foot of the section.
    await expect(page.getByText(emailFailed, { exact: true })).toHaveCount(1);
    await button.click();
    await expect(beside).toHaveText('Invitation email sent.');
    await expect(page.getByText('Invitation email sent.', { exact: true })).toHaveCount(1);
    expect(emails).toBe(2);
    await page.getByRole('button', { name: 'Copy Code', exact: true }).click();
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    }
  });

  test('an email whose answer is lost says so beside the button, and the exact same request is retried', async ({
    page,
  }) => {
    const posts: Record<string, unknown>[] = [];
    await issueCode(page, {
      email: (route) => {
        posts.push(route.request().postDataJSON() as Record<string, unknown>);
        return posts.length === 1
          ? route.abort()
          : route.fulfill({
              json: { id: invitationId, programmeId, email: 'sent', synthetic: false },
            });
      },
    });
    const beside = page.locator(
      'button:text-is("Email Invitation") + [role="status"][aria-live="polite"]',
    );
    await page.getByRole('button', { name: 'Email Invitation', exact: true }).click();
    await expect(beside).toHaveText(
      'Saving could not be confirmed. Retry the same request before changing it.',
    );
    await expect(page.getByLabel('Private invitation code', { exact: true })).toHaveValue(token);
    await page.getByRole('button', { name: 'Retry Same Participant Request', exact: true }).click();
    await expect(beside).toHaveText('Invitation email sent.');
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual(posts[0]);
    expect(posts[0]).toMatchObject({ action: 'emailInvitation', invitationId, token });
  });

  test('the code stays on screen while the list is read again, focus is back on the button and the page has not moved', async ({
    page,
  }) => {
    let release = () => {};
    const held = new Promise<void>((done) => (release = done));
    let reloads = 0;
    await page.setViewportSize({ width: 390, height: 844 });
    const code = await issueCode(page, {
      rows: 25,
      email: (route) =>
        route.fulfill({
          json: { id: invitationId, programmeId, email: 'sent', synthetic: false },
        }),
    });
    // The read that follows the email is held, so the page can be looked at while it runs.
    await page.route('**/api/customer-programme-participants*', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      reloads++;
      await held;
      return route.fallback();
    });
    const button = page.getByRole('button', { name: 'Email Invitation', exact: true });
    await button.scrollIntoViewIfNeeded();
    const top = () => button.evaluate((el) => Math.round(el.getBoundingClientRect().top));
    const before = await top();
    await button.click();
    await expect.poll(() => reloads).toBe(1);
    await expect(code).toBeVisible();
    await expect(code).toHaveValue(token);
    await expect(page.getByText('Checking programme participant access…')).toHaveCount(0);
    await expect(page.getByText('Invitation email sent.', { exact: true })).toBeVisible();
    release();
    await expect(button).toBeEnabled();
    await expect(button).toBeFocused();
    expect(Math.abs((await top()) - before)).toBeLessThanOrEqual(1);
    await expect(page.getByText('Spring buyers group 25', { exact: true })).toBeVisible();
  });

  test('an email cut off by leaving the page is never sent again in place of the next command', async ({
    page,
  }) => {
    let release = () => {};
    const held = new Promise<void>((done) => (release = done));
    const posts: Record<string, unknown>[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes(participantsApi))
        posts.push(request.postDataJSON() as Record<string, unknown>);
    });
    const code = await issueCode(page, {
      // The answer to the email does not arrive while the page is open.
      email: async (route) => {
        await held;
        await route.abort().catch(() => {});
      },
    });
    await page.getByRole('button', { name: 'Email Invitation', exact: true }).click();
    await expect.poll(() => posts.at(-1)?.action).toBe('emailInvitation');
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await expect(code).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
    // Back on the page the form sends what it says, not the email that was cut off.
    await page.getByLabel('Invitation label', { exact: true }).fill('Autumn buyers group');
    await page.getByRole('checkbox', { name: /permission to share this code/ }).check();
    await page.getByRole('button', { name: 'Create Invitation Code', exact: true }).click();
    await expect.poll(() => posts.length).toBe(3);
    expect(posts[2]).toMatchObject({ action: 'invite', label: 'Autumn buyers group' });
    await expect(code).toHaveValue(token);
    await expect(
      page.getByRole('button', { name: 'Retry Same Participant Request', exact: true }),
    ).toHaveCount(0);
    release();
  });

  test('an unconfirmed email retried after the code has left the screen still says what happened', async ({
    page,
  }) => {
    let emails = 0;
    const code = await issueCode(page, {
      email: (route) =>
        ++emails === 1
          ? route.abort()
          : route.fulfill({
              json: { id: invitationId, programmeId, email: 'sent', synthetic: false },
            }),
    });
    await page.getByRole('button', { name: 'Email Invitation', exact: true }).click();
    const retry = page.getByRole('button', { name: 'Retry Same Participant Request', exact: true });
    await expect(retry).toBeVisible();
    await page.getByRole('button', { name: 'Reload Programme Participants', exact: true }).click();
    await expect(code).toHaveCount(0);
    await retry.click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Invitation email sent.' }),
    ).toBeVisible();
    expect(emails).toBe(2);
  });

  test('the one-time code still clears at its expiry while the read after the email hangs', async ({
    page,
  }) => {
    let release = () => {};
    const held = new Promise<void>((done) => (release = done));
    let reloads = 0;
    await page.clock.install();
    const code = await issueCode(page, {
      email: (route) =>
        route.fulfill({
          json: { id: invitationId, programmeId, email: 'sent', synthetic: false },
        }),
    });
    await page.route('**' + participantsApi + '*', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      reloads++;
      await held;
      await route.abort().catch(() => {});
    });
    await page.getByRole('button', { name: 'Email Invitation', exact: true }).click();
    await expect.poll(() => reloads).toBe(1);
    await expect(code).toHaveValue(token);
    // The private view lasts 60 seconds from the read that drew it; the hanging read does not stretch that.
    await page.clock.fastForward(61_000);
    await expect(code).toHaveCount(0);
    await expect(page.getByText(/This private view expired/)).toBeVisible();
    await expect(page.getByText('Spring buyers group 1', { exact: true })).toHaveCount(0);
    release();
  });
});

// The route's answer to a code that matches no open invitation, and to an account with no access: the same 403.
const refuse = (route: Route) =>
  route.fulfill({ status: 403, json: { error: 'Access denied or link unavailable' } });
/** The participant's page with one registration; a code check is answered by `preview`. */
async function openCheck(
  page: Page,
  preview: (route: Route) => unknown,
  accessGone: () => boolean = () => false,
) {
  const posts: Record<string, unknown>[] = [];
  await serve(page, (route) => {
    if (route.request().method() === 'GET')
      return accessGone() ? refuse(route) : route.fulfill({ json: own() });
    posts.push(route.request().postDataJSON() as Record<string, unknown>);
    return preview(route);
  });
  await page.goto(fixturePath);
  await page.locator('summary', { hasText: 'Check an invitation' }).click();
  return posts;
}

test.describe('the participant checks a code (D-042, D-043, D-044)', () => {
  test('a wrong or expired code says so beside the field, and the section, the typed code and the registrations stay', async ({
    page,
  }) => {
    const posts = await openCheck(page, refuse);
    const code = page.getByLabel('Private invitation code', { exact: true });
    await code.fill(token);
    await page.getByRole('button', { name: 'Preview Invitation', exact: true }).click();
    const message = page.getByText(wrongCode, { exact: true });
    await expect(message).toBeVisible();
    await expect(page.getByText(accessCleared)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Check an invitation' })).toBeVisible();
    await expect(code).toBeVisible();
    await expect(code).toHaveValue(token);
    await expect(code).toBeEnabled();
    await expect(page.getByRole('heading', { name: 'Spring buyers programme' })).toBeVisible();
    // The message belongs to the field.
    await expect(code).toHaveAttribute('aria-invalid', 'true');
    const described = await code.getAttribute('aria-describedby');
    expect(described).toBeTruthy();
    await expect(page.locator(`[id="${described}"]`)).toHaveText(wrongCode);
    expect(posts).toEqual([{ action: 'preview', token }]);
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    }
    // It goes as soon as the code changes.
    await code.fill(token.slice(1));
    await expect(message).toHaveCount(0);
    await expect(code).not.toHaveAttribute('aria-invalid', 'true');
    const section = await page
      .getByRole('region', { name: 'My delegation participation' })
      .innerText();
    expect(section).not.toMatch(/synthetic|sample|draft|operator|scope/i);
  });

  test('a refused check with access really gone still clears the page and says access could not be confirmed', async ({
    page,
  }) => {
    let gone = false;
    await openCheck(
      page,
      (route) => {
        gone = true;
        return refuse(route);
      },
      () => gone,
    );
    const code = page.getByLabel('Private invitation code', { exact: true });
    await code.fill(token);
    await page.getByRole('button', { name: 'Preview Invitation', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: accessCleared })).toBeVisible();
    await expect(code).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Spring buyers programme' })).toHaveCount(0);
    await expect(page.getByText(wrongCode)).toHaveCount(0);
  });

  test('the registrations still clear at their expiry while the read after a refused check hangs', async ({
    page,
  }) => {
    let release = () => {};
    const held = new Promise<void>((done) => (release = done));
    let reloads = 0;
    await page.clock.install();
    await openCheck(page, refuse);
    await page.route('**' + participantsApi + '*', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      reloads++;
      await held;
      await route.abort().catch(() => {});
    });
    await page.getByLabel('Private invitation code', { exact: true }).fill(token);
    await page.getByRole('button', { name: 'Preview Invitation', exact: true }).click();
    await expect.poll(() => reloads).toBe(1);
    await expect(page.getByText(wrongCode, { exact: true })).toBeVisible();
    const registration = page.getByRole('heading', { name: 'Spring buyers programme' });
    await expect(registration).toBeVisible();
    await page.clock.fastForward(61_000);
    await expect(registration).toHaveCount(0);
    await expect(page.getByText(/This private view expired/)).toBeVisible();
    release();
  });

  test('a short code gets the site message, not the browser tooltip, and nothing is sent', async ({
    page,
  }) => {
    const posts = await openCheck(page, refuse);
    const code = page.getByLabel('Private invitation code', { exact: true });
    await expect(page.locator('form', { has: code })).toHaveJSProperty('noValidate', true);
    await code.pressSequentially('too-short');
    await page.getByRole('button', { name: 'Preview Invitation', exact: true }).click();
    const message = page.getByText(shortCode, { exact: true });
    await expect(message).toBeVisible();
    await expect(code).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator(`[id="${await code.getAttribute('aria-describedby')}"]`)).toHaveText(
      shortCode,
    );
    expect(posts).toHaveLength(0);
    await code.pressSequentially('x');
    await expect(message).toHaveCount(0);
    // A code of the right length with a character no code has is the same mistake.
    await code.fill('!'.repeat(43));
    await page.getByRole('button', { name: 'Preview Invitation', exact: true }).click();
    await expect(message).toBeVisible();
    expect(posts).toHaveLength(0);
  });

  test('the preview says when the invitation expires in words, never as a raw timestamp', async ({
    page,
  }) => {
    await openCheck(page, (route) =>
      route.fulfill({
        json: {
          programmeId,
          name: 'Autumn buyers programme',
          reportingPurpose: 'A shared programme purpose with no private commercial details',
          expiresAt,
          synthetic: false,
        },
      }),
    );
    await page.getByLabel('Private invitation code', { exact: true }).fill(token);
    await page.getByRole('button', { name: 'Preview Invitation', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Autumn buyers programme' })).toBeVisible();
    await expect(page.getByText(`Invitation expires ${expiresWords}.`)).toBeVisible();
    await expect(page.getByText(/T06:21/)).toHaveCount(0);
  });
});
