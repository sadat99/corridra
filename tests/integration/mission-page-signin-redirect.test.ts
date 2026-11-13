import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The signed-out redirect of the mission page keeps the reply the team came for (ADR-081 C6). No database, no browser.
const web = createRequire(resolve('apps/web/package.json'));
const mission = '11111111-1111-4111-8111-111111111111';
const reply = '22222222-2222-4222-8222-222222222222';
const workspace = '33333333-3333-4333-8333-333333333333';
const nothing = () => null;

beforeEach(() => {
  vi.resetModules();
  vi.doMock(web.resolve('next/headers'), () => ({ headers: async () => new Headers() }));
  vi.doMock(web.resolve('next/navigation'), () => ({
    notFound: () => {
      throw new Error('NOT FOUND');
    },
    redirect: (to: string) => {
      throw new Error(`REDIRECT ${to}`);
    },
  }));
  vi.doMock(web.resolve('next/link'), () => ({ default: nothing }));
  vi.doMock(resolve('apps/web/lib/ux-switches.ts'), () => ({ uxSwitchOn: () => true }));
  vi.doMock(resolve('apps/web/lib/foundations.ts'), () => ({
    foundations: () => ({
      ready: Promise.resolve(),
      provider: { getSession: async () => null },
    }),
  }));
  vi.doMock(resolve('apps/web/components/ux/team-context-publisher.tsx'), () => ({
    TeamContextPublisher: nothing,
  }));
  vi.doMock(resolve('apps/web/components/workspace-shell.tsx'), () => ({
    WorkspaceShell: nothing,
  }));
  vi.doMock(resolve('apps/web/components/ux/team-second-level.tsx'), () => ({
    TeamSecondLevel: nothing,
  }));
  vi.doMock(resolve('apps/web/app/operator/operator-flags.tsx'), () => ({
    OperatorFlags: nothing,
  }));
  vi.doMock(resolve('apps/web/app/operator/[section]/[missionId]/mission-page.tsx'), () => ({
    MissionPage: nothing,
  }));
});
afterEach(() => vi.resetModules());

/** Runs the page signed out and returns the address it returns to after sign-in. */
async function returnAddress(search: { workspace?: string; reply?: string }) {
  const path = 'app/operator/[section]/[missionId]/page';
  const { default: Page } = await import(/* @vite-ignore */ `../../apps/web/${path}`);
  const error = await Page({
    params: Promise.resolve({ section: 'missions', missionId: mission }),
    searchParams: Promise.resolve(search),
  }).then(
    () => new Error('no redirect'),
    (e: Error) => e,
  );
  const [, to] = error.message.match(/^REDIRECT \/operator\/signin\?next=(.+)$/) ?? [];
  if (!to) throw error;
  return new URL(decodeURIComponent(to), 'https://x.test');
}

describe('mission page sign-in redirect', () => {
  it('keeps ?reply and ?workspace in the address it returns to', async () => {
    const next = await returnAddress({ workspace, reply });
    expect(next.pathname).toBe(`/operator/missions/${mission}`);
    expect(next.searchParams.get('reply')).toBe(reply);
    expect(next.searchParams.get('workspace')).toBe(workspace);
  });

  it('keeps ?reply on its own, and drops one that is not an id', async () => {
    const only = await returnAddress({ reply });
    expect(only.searchParams.get('reply')).toBe(reply);
    expect(only.searchParams.has('workspace')).toBe(false);
    const bad = await returnAddress({ reply: 'not-an-id' });
    expect(bad.search).toBe('');
  });
});
