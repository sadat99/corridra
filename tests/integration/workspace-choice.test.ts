import { expect, test } from 'vitest';
import {
  activeWorkspaces,
  keepsArchived,
  offeredWorkspaces,
  workspaceDestinations,
  workspacePath,
  workspacesFor,
} from '../../apps/web/lib/workspace-choice';

const id = '12345678-abcd-1234-abcd-123456789abc';
const rows = [
  { id: 'a', role: 'owner' },
  { id: 'b', role: 'admin' },
  { id: 'c', role: 'member' },
];

test('programme management lists only workspaces the person owns or manages', () => {
  expect(workspacesFor('programmes', rows).map((r) => r.id)).toEqual(['a', 'b']);
  expect(workspacesFor('programmes', [rows[2]!])).toEqual([]);
});

test('profile, help requests and plans stay open to every member of a workspace', () => {
  for (const kind of ['profile', 'services', 'billing'] as const)
    expect(workspacesFor(kind, rows).map((r) => r.id)).toEqual(['a', 'b', 'c']);
});

type Row = { id: string; role: string; archived?: boolean };
const mixed: Row[] = [
  { id: 'a', role: 'owner', archived: false },
  { id: 'b', role: 'owner', archived: true },
  { id: 'c', role: 'member' },
  { id: 'd', role: 'admin', archived: true },
  { id: 'e', role: 'admin', archived: false },
];
const ids = (list: readonly { id: string }[]) => list.map((r) => r.id);

test('active workspaces drop the archived ones, keep the order and treat a missing flag as not archived', () => {
  expect(ids(activeWorkspaces(mixed))).toEqual(['a', 'c', 'e']);
  expect(activeWorkspaces([])).toEqual([]);
  expect(activeWorkspaces(mixed.filter((r) => r.archived === true))).toEqual([]);
  expect(ids(activeWorkspaces<Row>(rows))).toEqual(['a', 'b', 'c']);
});

test('a menu offers the active workspaces, plus the archived one whose page this is, last', () => {
  expect(ids(offeredWorkspaces(mixed))).toEqual(['a', 'c', 'e']);
  expect(ids(offeredWorkspaces(mixed, mixed[0]))).toEqual(['a', 'c', 'e']);
  expect(ids(offeredWorkspaces(mixed, mixed[1]))).toEqual(['a', 'c', 'e', 'b']);
  expect(ids(offeredWorkspaces([mixed[3]!], mixed[3]!))).toEqual(['d']);
});

test('programmes and help requests hide archived workspaces; billing and the profile keep them', () => {
  expect(ids(workspacesFor('programmes', mixed))).toEqual(['a', 'e']);
  expect(ids(workspacesFor('services', mixed))).toEqual(['a', 'c', 'e']);
  for (const kind of ['billing', 'profile'] as const) {
    expect(keepsArchived(kind)).toBe(true);
    expect(ids(workspacesFor(kind, mixed))).toEqual(['a', 'b', 'c', 'd', 'e']);
  }
  expect(keepsArchived('programmes')).toBe(false);
  expect(keepsArchived('services')).toBe(false);
});

test('including archived workspaces for programmes still keeps only owners and admins', () => {
  expect(ids(workspacesFor('programmes', mixed, true))).toEqual(['a', 'b', 'd', 'e']);
  expect(ids(workspacesFor('services', mixed, true))).toEqual(['a', 'b', 'c', 'd', 'e']);
});

test('each destination is one account path under the workspace and encodes the id', () => {
  expect(workspacePath('profile', id)).toBe('/account/profile/' + id);
  expect(workspacePath('programmes', id)).toBe('/account/delegations/' + id);
  expect(workspacePath('services', id)).toBe('/account/service-requests/' + id);
  expect(workspacePath('billing', id)).toBe('/account/billing/' + id);
  expect(workspacePath('services', 'a/b?c')).toBe('/account/service-requests/a%2Fb%3Fc');
  expect(Object.keys(workspaceDestinations).sort()).toEqual([
    'billing',
    'profile',
    'programmes',
    'services',
  ]);
});
