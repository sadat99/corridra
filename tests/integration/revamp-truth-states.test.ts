import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMoveModel, type MoveInput } from '../../apps/web/lib/move-cards';

// Revamp Wave 1: an empty screen must mean "there is nothing", never "we could not look". Your Move
// reads up to seven sources; a source that is switched on and fails is named, and the screen then
// says it could not check instead of "Nothing is waiting for you right now."
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...children: unknown[]
) => unknown;
const renderToStaticMarkup = web('react-dom/server').renderToStaticMarkup as (
  element: unknown,
) => string;
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

const on = {
  workspaces: true,
  drafts: true,
  services: true,
  links: true,
  requests: true,
  moves: true,
};
vi.mock('../../packages/auth/src/customer-workspaces.ts', () => ({
  customerWorkspacesEnabled: () => on.workspaces,
}));
vi.mock('../../packages/auth/src/customer-mission-drafts.ts', () => ({
  customerMissionDraftsEnabled: () => on.drafts,
}));
vi.mock('../../packages/auth/src/customer-service-requests.ts', () => ({
  customerServiceRequestsEnabled: () => on.services,
}));
vi.mock('../../packages/auth/src/customer-organisation-links.ts', () => ({
  customerOrganisationLinksEnabled: () => on.links,
}));
vi.mock('../../packages/auth/src/customer-requests.ts', () => ({
  customerRequestsEnabled: () => on.requests,
}));
vi.mock('../../packages/auth/src/customer-moves.ts', () => ({
  customerMovesEnabled: () => on.moves,
}));

const owner = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Atelier Rahman',
  role: 'owner' as const,
};
const fail = () => Promise.reject(new Error('database unavailable'));
type Services = Record<string, unknown> & { ready: Promise<void> };
let services: Services | null = null;
vi.mock('../../apps/web/lib/foundations', () => ({ foundations: () => services }));

function healthy(): Services {
  return {
    ready: Promise.resolve(),
    customerWorkspaces: { list: async () => [owner] },
    customerMissionDrafts: { list: async () => ({ drafts: [], nextAfter: null }) },
    customerServiceRequests: { list: async () => ({ requests: [], nextAfter: null }) },
    customerOrganisationLinks: { overview: async () => ({ workspaces: [] }) },
    customerRequests: { list: async () => ({ requests: [], nextAfter: null }) },
    customerMoves: { list: async () => ({ requests: [] }) },
  };
}
const loadWeb = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
const load = async () => (await import('../../apps/web/lib/move-loader')).loadMoveInput;

beforeEach(() => {
  Object.assign(on, {
    workspaces: true,
    drafts: true,
    services: true,
    links: true,
    requests: true,
    moves: true,
  });
  services = healthy();
});

describe('Your Move loader names every source it could not read', () => {
  it('reads everything: nothing unreadable, a true empty', async () => {
    const loaded = await (await load())('subject', 'issuer');
    expect(loaded.unreadable).toEqual([]);
    expect(loaded.input.workspaces).toHaveLength(1);
  });

  it('the workspace module off is a true empty, not a failure', async () => {
    on.workspaces = false;
    const loaded = await (await load())('subject', 'issuer');
    expect(loaded.unreadable).toEqual([]);
  });

  it('no database wiring, or a database that never becomes ready, is unreadable', async () => {
    services = null;
    expect((await (await load())('s', 'i')).unreadable).toEqual(['account']);
    services = { ...healthy(), ready: fail() };
    (services.ready as Promise<void>).catch(() => undefined);
    expect((await (await load())('s', 'i')).unreadable).toEqual(['account']);
  });

  it('each failing source is named, and a source that is off is never blamed', async () => {
    services = {
      ...healthy(),
      customerWorkspaces: { list: fail },
      customerOrganisationLinks: { overview: fail },
      customerRequests: { list: fail },
      customerMoves: { list: fail },
      customerDeliveredReports: { list: fail },
    };
    const loaded = await (await load())('s', 'i');
    expect([...loaded.unreadable].sort()).toEqual([
      'companies',
      'moves',
      'reports',
      'requests',
      'workspaces',
    ]);
    expect(loaded.requestCreationEnabled).toBe(false);

    on.links = false;
    on.moves = false;
    const quieter = await (await load())('s', 'i');
    expect(quieter.unreadable).not.toContain('companies');
    expect(quieter.unreadable).not.toContain('moves');
  });

  it('a draft or quote list that fails on its first page is named', async () => {
    services = {
      ...healthy(),
      customerMissionDrafts: { list: fail },
      customerServiceRequests: { list: fail },
    };
    const loaded = await (await load())('s', 'i');
    expect([...loaded.unreadable].sort()).toEqual(['drafts', 'quotes']);
  });
});

describe('Your Move never says nothing is waiting when it could not look', () => {
  const empty: MoveInput = {
    workspaces: [],
    drafts: [],
    quotes: [],
    companyLinks: [],
    requests: [],
  };
  const render = async (props: Record<string, unknown>) => {
    const { MoveView } = await loadWeb('app/account/move/move-view');
    return renderToStaticMarkup(createElement(MoveView, props));
  };

  it('an unreadable empty list says it could not check, in English, and offers a retry', async () => {
    const html = await render({
      model: buildMoveModel(empty),
      startHref: '/plan',
      unreadable: true,
    });
    expect(html).not.toContain('Nothing is waiting for you right now.');
    expect(html).toContain('We could not check everything just now.');
    expect(html).toContain('Your work is safe.');
    expect(html).toMatch(/lang="en"[^>]*>|<div class="move-empty" role="status" lang="en">/);
    expect(html).toContain('href="/account/move"');
    expect(html).toContain('Start a Request');
  });

  it('a readable empty list keeps the honest empty words exactly as before', async () => {
    const html = await render({ model: buildMoveModel(empty), startHref: '/plan' });
    expect(html).toContain('Nothing is waiting for you right now.');
    expect(html).not.toContain('We could not check everything just now.');
  });

  it('cards that were read are shown, with a note that the list may be incomplete', async () => {
    const html = await render({
      model: buildMoveModel({
        ...empty,
        workspaces: [owner],
        drafts: [
          { id: 'd1', workspaceId: owner.id, title: 'Cutting machine', updatedAt: '2026-10-01' },
        ],
      }),
      startHref: '/plan',
      unreadable: true,
    });
    expect(html).toContain('Send your draft request');
    expect(html).toContain('this list may not show everything');
    expect(html).not.toContain('Nothing is waiting for you right now.');
  });
});

describe('reports for your requests say when they could not be read', () => {
  const draw = async () => {
    const { DeliveredReports } = await loadWeb('app/account/delivered-reports');
    const element = await DeliveredReports({ subject: 's', issuer: 'i' });
    return element ? renderToStaticMarkup(element) : '';
  };

  it('a failed read is a visible status, never a silent gap', async () => {
    services = { ...healthy(), customerDeliveredReports: { list: fail } };
    const html = await draw();
    expect(html).toContain('Your reports could not be loaded just now.');
    expect(html).toContain('role="status"');
    expect(html).toContain('lang="en"');
  });

  it('no reports, or no report service, still shows nothing: the Library never invents one', async () => {
    services = { ...healthy(), customerDeliveredReports: { list: async () => [] } };
    expect(await draw()).toBe('');
    services = healthy();
    expect(await draw()).toBe('');
  });
});
