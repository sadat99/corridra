import { describe, expect, it } from 'vitest';
import { ReplyError, loadReason, withReason } from '../../apps/web/lib/load-reason';

describe('panel load reason codes', () => {
  it('names the status, the failed reply check, a timeout or a network failure', () => {
    expect(loadReason(new ReplyError('HTTP 500'), false)).toBe('HTTP 500');
    expect(loadReason(new ReplyError('reply workspace'), true)).toBe('reply workspace');
    expect(loadReason(new DOMException('aborted', 'AbortError'), true)).toBe('timed out');
    expect(loadReason(new SyntaxError('Unexpected token <'), false)).toBe('unreadable reply');
    expect(loadReason(new TypeError('Failed to fetch'), false)).toBe('network');
    expect(loadReason(new Error('other'), false)).toBe('unexpected');
  });
  it('adds the code inside the sentence and keeps the retry advice', () => {
    expect(withReason('The company profile could not be loaded. Try again.', 'HTTP 500')).toBe(
      'The company profile could not be loaded (code: HTTP 500). Try again.',
    );
    expect(withReason('Saved.', 'HTTP 500')).toBe('Saved.');
  });
});
