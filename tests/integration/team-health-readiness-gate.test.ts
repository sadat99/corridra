import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { sectionRefusedForRole } from '../../apps/web/lib/workspace-navigation';

// F8 (owner decision, 25 Nov 2026): an ordinary operator may not open Health or Readiness by address. The server page
// decides from the role of the workspace in view, with the v4.1 switch ON or OFF, and sends the person to Today.
const tenant = '11111111-1111-4111-8111-111111111111';
const other = '33333333-3333-4333-8333-333333333333';
const state = vi.hoisted(() => ({
  tenants: [] as { id: string; name: string; role: string }[],
  redirected: [] as string[],
}));
vi.mock('@corridra/auth/customer-moves', () => ({ customerMovesEnabled: () => false }));
vi.mock('../../apps/web/lib/foundations', () => ({
  foundations: () => ({
    ready: Promise.resolve(),
    provider: { getSession: async () => ({ token: 'staff-token' }) },
    access: { tenants: async () => state.tenants },
  }),
}));
vi.mock('../../apps/web/lib/owner-access', () => ({
  ownerCapable: () => [],
  ownerPageEnabled: () => false,
}));
vi.mock('../../apps/web/lib/problem-reports-offered', () => ({
  problemReportsOffered: async () => false,
}));
vi.mock('../../apps/web/lib/programme-applications-offered', () => ({
  programmeApplicationsOffered: async () => false,
}));
vi.mock('../../apps/web/components/workspace-shell', () => ({ WorkspaceShell: () => null }));
vi.mock('../../apps/web/components/ux/team-second-level', () => ({ TeamSecondLevel: () => null }));
vi.mock('../../apps/web/components/ux/desk-frame', () => ({
  operatorHeader: () => ({ eyebrow: '', title: '', lead: '', className: '', segments: null }),
}));
vi.mock('../../apps/web/app/operator/operator-flags', () => ({ OperatorFlags: () => null }));
vi.mock('../../apps/web/app/operator/workspace', () => ({ Workspace: () => null }));

// Held in a variable so the root type check does not follow a .tsx file (it has no JSX setting).
const entryPath = '../../apps/web/app/operator/operator-entry';
const web = createRequire(resolve('apps/web/package.json'));
let OperatorEntry: (props: { requested?: string; section?: string }) => Promise<unknown>;
beforeAll(async () => {
  vi.doMock(web.resolve('next/navigation'), () => ({
    redirect: (to: string) => {
      state.redirected.push(to);
      throw new Error('REDIRECT');
    },
    notFound: () => {
      throw new Error('NOT_FOUND');
    },
  }));
  vi.doMock(web.resolve('next/headers'), () => ({ headers: async () => new Headers() }));
  vi.doMock(web.resolve('next/link'), () => ({ default: () => null }));
  ({ OperatorEntry } = await import(/* @vite-ignore */ entryPath));
});

const open = async (section: string | undefined, requested = tenant) => {
  state.redirected = [];
  try {
    await OperatorEntry({ requested, section });
    return 'rendered';
  } catch (error) {
    if ((error as Error).message === 'REDIRECT') return 'redirected';
    throw error;
  }
};

describe('the pure rule', () => {
  test('only owner and admin are given Health and Readiness; nothing else is refused here', () => {
    for (const section of ['ops-health', 'ops-gates']) {
      expect(sectionRefusedForRole(section, 'owner')).toBe(false);
      expect(sectionRefusedForRole(section, 'admin')).toBe(false);
      for (const role of ['operator', 'reviewer', 'viewer', '', null, undefined])
        expect(sectionRefusedForRole(section, role), `${section} ${role}`).toBe(true);
    }
    for (const section of ['workspace-operations', 'ops-dashboard', 'workspace-missions'])
      expect(sectionRefusedForRole(section, 'viewer')).toBe(false);
  });
});

describe.each([
  ['switch OFF', 'false'],
  ['switch ON', 'true'],
])('/operator/health and /operator/readiness, v4.1 %s', (_name, value) => {
  beforeEach(() => {
    vi.stubEnv('CORRIDRA_UX_SHELLS_V2', 'true');
    vi.stubEnv('CORRIDRA_UX_OPERATOR_URLS', 'true');
    vi.stubEnv('CORRIDRA_UX_TEAM_DESK_V41', value);
  });
  for (const section of ['ops-health', 'ops-gates']) {
    test(`${section}: an operator, reviewer or viewer is sent to Today and the page is never built`, async () => {
      for (const role of ['operator', 'reviewer', 'viewer']) {
        state.tenants = [{ id: tenant, name: 'Team', role }];
        expect(await open(section), role).toBe('redirected');
        expect(state.redirected, role).toEqual(['/operator?workspace=' + tenant]);
      }
    });
    test(`${section}: owner and admin still open it`, async () => {
      for (const role of ['owner', 'admin']) {
        state.tenants = [{ id: tenant, name: 'Team', role }];
        expect(await open(section), role).toBe('rendered');
      }
    });
    test(`${section}: the role of the workspace in view decides, not of another one`, async () => {
      state.tenants = [
        { id: tenant, name: 'A', role: 'operator' },
        { id: other, name: 'B', role: 'owner' },
      ];
      expect(await open(section, tenant)).toBe('redirected');
      expect(await open(section, other)).toBe('rendered');
    });
  }
  test('other sections an operator may open are not touched', async () => {
    state.tenants = [{ id: tenant, name: 'Team', role: 'operator' }];
    for (const section of [
      'workspace-operations',
      'ops-dashboard',
      'workspace-missions',
      undefined,
    ])
      expect(await open(section), String(section)).toBe('rendered');
  });
});
