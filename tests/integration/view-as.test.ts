import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  viewAsAvailable,
  viewAsAvailableRoles,
  viewAsEnabled,
  viewAsRole,
  viewAsRoles,
} from '../../packages/auth/src/view-as';
import { viewAsMethodRefusal } from '../../apps/web/lib/view-as-gate';
import { describeSwitches } from '../../apps/web/lib/owner-switches';
import { permissions } from '../../packages/domain/src/index';

const folder = 'apps/web/app/operator/view-as';
const files = (directory: string): string[] =>
  readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });

describe('the switch and the roles', () => {
  it('is on only when the setting is exactly true', () => {
    expect(viewAsEnabled({ CORRIDRA_VIEW_AS_ENABLED: 'true' } as NodeJS.ProcessEnv)).toBe(true);
    for (const value of [undefined, '', 'false', 'TRUE', 'True', '1', 'yes', ' true'])
      expect(viewAsEnabled({ CORRIDRA_VIEW_AS_ENABLED: value } as NodeJS.ProcessEnv)).toBe(false);
  });
  it('is off by default on the Owner page', () => {
    const row = describeSwitches({})
      .flatMap((g) => g.rows)
      .find((r) => r.name === 'CORRIDRA_VIEW_AS_ENABLED');
    expect(row?.state.text).toBe('Off');
  });
  it('accepts only the three fixed roles, exactly', () => {
    for (const role of viewAsRoles) expect(viewAsRole(role)).toBe(role);
    for (const value of [
      'Customer',
      'owner',
      'customer ',
      '',
      null,
      undefined,
      3,
      '../customer',
      'customer/x',
    ])
      expect(viewAsRole(value)).toBeNull();
  });
  it('builds the customer preview only in stage 1', () => {
    expect(viewAsAvailableRoles).toEqual(['customer']);
    expect(viewAsAvailable('customer')).toBe(true);
    expect(viewAsAvailable('delegate')).toBe(false);
    expect(viewAsAvailable('supplier')).toBe(false);
  });
  it('is permitted for owners and admins only', () => {
    expect(permissions['viewas.open']).toEqual(['owner', 'admin']);
  });
});

describe('a preview can only be read', () => {
  const request = (path: string, method: string) =>
    new Request('https://corridra.test' + path, { method });
  it('refuses every method but GET and HEAD under the preview path with a 405', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])
      for (const path of [
        '/operator/view-as/customer',
        '/operator/view-as',
        '/operator/view-as/customer/x',
      ]) {
        const refused = viewAsMethodRefusal(request(path, method));
        expect(refused?.status, `${method} ${path}`).toBe(405);
        expect(refused?.headers.get('allow')).toBe('GET, HEAD');
        expect(refused?.headers.get('cache-control')).toBe('no-store');
      }
  });
  it('lets GET and HEAD through, and leaves every other path alone', () => {
    for (const method of ['GET', 'HEAD'])
      expect(viewAsMethodRefusal(request('/operator/view-as/customer', method))).toBeNull();
    for (const path of [
      '/operator',
      '/operator/owner',
      '/operator/view-asx',
      '/operator/view-as-more/customer',
      '/api/x',
    ])
      expect(viewAsMethodRefusal(request(path, 'POST'))).toBeNull();
  });
});

describe('the preview code cannot act, fetch, sign in or read a person', () => {
  const pages = files(folder);
  const source = pages.map((path) => [path, readFileSync(path, 'utf8')] as const);
  it('has no route handler, server action, client component or script', () => {
    expect(pages.filter((path) => /route\.(ts|tsx)$/.test(path))).toEqual([]);
    for (const [path, text] of source) {
      expect(text, path).not.toMatch(/['"]use (client|server)['"]/);
      expect(text, path).not.toMatch(/\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|EventSource)\b/);
      expect(text, path).not.toMatch(/<(form|button|input|select|textarea|script|iframe)\b/);
      expect(text, path).not.toMatch(/\bonClick\b|\baction=/);
    }
  });
  it('links nowhere but back to the workspace', () => {
    for (const [path, text] of source)
      for (const [, href] of text.matchAll(/href=["']([^"']+)["']/g))
        expect(href, path).toBe('/operator');
  });
  it('never reads a customer, delegate or supplier session or cookie', () => {
    for (const [path, text] of source) {
      expect(text, path).not.toMatch(
        /customer-session|readCustomerSession|neon-auth|neonAuth|cookies\(|CustomerRequestService/,
      );
    }
  });
  it('keeps the whole page inert and marks the preview in the page, the title and the address', () => {
    const page = readFileSync(join(folder, '[role]/page.tsx'), 'utf8');
    expect(page).toContain('inert');
    expect(page).toContain('PREVIEW AS CUSTOMER. Sample data. This is not a real account.');
    expect(page).toContain('Preview: ${role} screen');
    expect(page).toContain('robots: { index: false, follow: false }');
    expect(page).toContain('Close preview');
  });
});
