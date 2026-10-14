import { describe, expect, it } from 'vitest';
import { operatorReturnTo, workspaceSections } from '../../apps/web/lib/workspace-navigation';

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
