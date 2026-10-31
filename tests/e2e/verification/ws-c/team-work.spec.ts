import { randomBytes, randomUUID } from 'node:crypto';
import { test, expect, qaSeed, evidence, expectNoForbiddenCopy, visibleCopy } from '../fixtures';

// WS-C verification (program 6.C and section 8). These run signed out against the local production build
// with the program flags on. Signed-in team journeys are proved by tests/operator/*.spec.ts (KI-16), which
// open a fresh client link in a new signed-out browser context, then prove expiry and revocation deny.

const ws = () => qaSeed().streams['ws-c'] as { tenantId: string; missionId: string };
const linkGone = 'This private link has expired or was replaced';

test.describe('private link views (CQ-42, CQ-78)', () => {
  for (const path of ['/client', '/programme']) {
    test(`${path} with an unknown link says it plainly and shows nothing private`, async ({
      page,
    }, info) => {
      const statuses: number[] = [];
      page.on('response', (r) => {
        if (r.url().endsWith('/api/delivery')) statuses.push(r.status());
      });
      const response = await page.goto(`${path}#${randomBytes(32).toString('hex')}`);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole('main').getByRole('alert')).toContainText(linkGone);
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
      // The server refused the unknown link; the page never rendered report sections.
      await expect.poll(() => statuses.at(-1)).toBe(403);
      await expect(page.getByRole('navigation', { name: 'Approved report sections' })).toHaveCount(
        0,
      );
      const text = await visibleCopy(page);
      expect(text).not.toMatch(/Retry approved view|your Corridra operator/i);
      await expectNoForbiddenCopy(page);
      await evidence(page, `V-31-${path.slice(1)}-unknown-link-${info.project.name}`);
    });
  }
  test('a missing link is refused before any request is sent', async ({ page }) => {
    let calls = 0;
    page.on('request', (r) => {
      if (r.url().endsWith('/api/delivery')) calls += 1;
    });
    await page.goto('/client');
    await expect(page.getByRole('main').getByRole('alert')).toContainText(linkGone);
    expect(calls).toBe(0);
  });
  test('the delivery API answers only POST', async ({ request }) => {
    const r = await request.get('/api/delivery');
    expect(r.status()).toBe(405);
    expect(r.headers()['cache-control']).toContain('no-store');
  });
});

test.describe('mission page address (D15)', () => {
  test('signed out, a mission page sends the person to team sign-in and back', async ({ page }) => {
    const { missionId, tenantId } = ws();
    await page.goto(`/operator/missions/${missionId}?workspace=${tenantId}`);
    await expect(page).toHaveURL(/\/operator\/signin\?next=/);
    expect(decodeURIComponent(page.url())).toContain(`/operator/missions/${missionId}`);
  });
  test('only the missions section word and a mission id open the page', async ({ request }) => {
    for (const path of [
      `/operator/research/${randomUUID()}`,
      `/operator/delivery/${randomUUID()}`,
      '/operator/missions/not-a-mission',
    ]) {
      const r = await request.get(path, { maxRedirects: 0 });
      expect(r.status(), path).toBe(404);
    }
  });
  test('the team-work API refuses a signed-out reader', async ({ request }) => {
    const { missionId, tenantId } = ws();
    const mission = await request.get(`/api/team-work/mission?tenant=${tenantId}&id=${missionId}`);
    expect(mission.status()).toBe(401);
    expect(await mission.json()).toEqual({ error: 'Sign in to continue' });
    expect(mission.headers()['cache-control']).toContain('no-store');
    const flags = await request.get('/api/team-work/flags');
    expect(flags.status()).toBe(401);
    const unknown = await request.get('/api/team-work/anything');
    expect(unknown.status()).toBe(401);
  });
});
