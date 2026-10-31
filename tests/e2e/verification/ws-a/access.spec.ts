import { test, expect, evidence } from '../fixtures';

// WS-A account entry pages (program 6.A). A-4: the create-account page says what it is for and shows the
// password rule before anyone submits (CQ-38). A-6: `/signin?next=` keeps only a safe internal page, through
// the same reviewed list as `returnTo` (CQ-45); anything else falls back to the account.

test('A-4 the create-account page shows its purpose and the password rule before submit', async ({
  page,
}, info) => {
  const response = await page.goto('/signup');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle('Create account | Corridra');
  const main = page.getByRole('main');
  await expect(main).toContainText('Create your account to send and follow requests.');
  await expect(main).not.toContainText('Sign in to see your account');
  await expect(page.locator('#password-rule')).toContainText(
    'Your password needs at least 14 characters.',
  );
  await expect(page.locator('#password-rule')).toBeVisible();
  await evidence(page, `A-4-${info.project.name}`);
});

test('A-6 the sign-in page honours a safe next path and refuses any other', async ({
  page,
}, info) => {
  const location = async (path: string) => {
    const answer = await page.request.get(path, { maxRedirects: 0 });
    expect([303, 307, 308], path).toContain(answer.status());
    return answer.headers()['location'] ?? '';
  };
  expect(await location('/signin?next=%2Fplan')).toMatch(/\/signin\?returnTo=%2Fplan$/);
  expect(await location('/signin?next=%2Fplan&method=code')).toMatch(
    /\/signin\?returnTo=%2Fplan&method=code$/,
  );
  for (const unsafe of [
    '//example.invalid/plan',
    'https://example.invalid/plan',
    '/plan?token=private',
    '/account/../operator',
    'javascript:alert(1)',
  ])
    expect(await location(`/signin?next=${encodeURIComponent(unsafe)}`), unsafe).toMatch(
      /\/signin$/,
    );
  // A returnTo already present wins; next is not read twice.
  const kept = await page.request.get('/signin?returnTo=%2Fplan&next=%2Fplan', { maxRedirects: 0 });
  expect(kept.headers()['location'] ?? '').not.toMatch(/\/signin\?/);
  await page.goto('/signin?next=%2Fplan');
  await evidence(page, `A-6-${info.project.name}`);
});
