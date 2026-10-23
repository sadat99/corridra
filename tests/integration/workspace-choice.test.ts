import { expect, test } from 'vitest';
import {
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
