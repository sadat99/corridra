import { describe, expect, it } from 'vitest';
import {
  operatorReturnTo,
  operatorSignInPage,
  operatorSignInPath,
  workspaceSections,
} from '../../apps/web/lib/workspace-navigation';

describe('protected tool return destinations', () => {
  it('preserves registered tool and workspace destinations only', () => {
    const workspace = '12345678-abcd-1234-abcd-123456789abc';
    for (const section of workspaceSections) {
      for (const prefix of ['/operator', '/operator?workspace=' + workspace]) {
        expect(operatorReturnTo(prefix + '#' + section.id)).toBe(prefix + '#' + section.id);
      }
    }
    expect(operatorReturnTo('/contributor?workspace=' + workspace)).toBe(
      '/contributor?workspace=' + workspace,
    );
  });
  it('rejects external URLs, unknown actions, credentials and invented fragments', () => {
    for (const next of [
      'https://example.invalid',
      '//example.invalid',
      '/operator/../api/workspace/config',
      '/operator?next=https://example.invalid',
      '/operator#missing',
      '/operator?workspace=invalid',
      '/contributor?workspace=123',
      '/operator#ops-center?token=private',
      '/operator\\example.invalid',
    ]) {
      expect(operatorReturnTo(next)).toBe('/operator');
    }
  });
});

describe('the sign-in address that comes back to a workspace', () => {
  const workspace = '12345678-abcd-1234-abcd-123456789abc';
  // Every address is the sign-in page with one `next`, and that `next` survives the closed return list.
  function returnOf(href: string): string {
    expect(href.startsWith(operatorSignInPage + '?next=')).toBe(true);
    const url = new URL(href, 'http://corridra.invalid');
    expect(url.pathname).toBe('/operator/signin');
    expect([...url.searchParams.keys()]).toEqual(['next']);
    const next = url.searchParams.get('next')!;
    expect(operatorReturnTo(next)).toBe(next);
    return next;
  }

  it('is built from the one operator sign-in page address', () => {
    expect(operatorSignInPage).toBe('/operator/signin');
  });

  it('keeps the workspace and every listed section', () => {
    for (const id of [...workspaceSections.map((section) => section.id), 'workspace-navigation'])
      expect(returnOf(operatorSignInPath(workspace, id))).toBe(
        '/operator?workspace=' + workspace + '#' + id,
      );
    expect(returnOf(operatorSignInPath(workspace))).toBe('/operator?workspace=' + workspace);
    expect(returnOf(operatorSignInPath(workspace, ''))).toBe('/operator?workspace=' + workspace);
  });

  it('gives the authenticator panel the same address as before', () => {
    expect(operatorSignInPath(workspace, 'workspace-authenticator')).toBe(
      '/operator/signin?next=' +
        encodeURIComponent('/operator?workspace=' + workspace + '#workspace-authenticator'),
    );
  });

  it('drops a section that is not listed and keeps the workspace', () => {
    for (const section of [
      'main',
      'nonexistent',
      'workspace-sources?token=x',
      '//example.invalid',
      'WORKSPACE-SOURCES',
      '__proto__',
      'constructor',
    ])
      expect(returnOf(operatorSignInPath(workspace, section))).toBe(
        '/operator?workspace=' + workspace,
      );
  });

  it('drops a workspace that is not an id and keeps a listed section', () => {
    for (const bad of ['invalid', workspace + 'a', workspace + '#ops-center', '../x']) {
      expect(returnOf(operatorSignInPath(bad, 'workspace-sources'))).toBe(
        '/operator#workspace-sources',
      );
      expect(returnOf(operatorSignInPath(bad, 'nonexistent'))).toBe('/operator');
      expect(returnOf(operatorSignInPath(bad))).toBe('/operator');
    }
    expect(returnOf(operatorSignInPath())).toBe('/operator');
  });
});
