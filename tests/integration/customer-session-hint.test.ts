import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { customerSessionHinted } from '../../apps/web/lib/customer-session-hint';

// Final walk m2 (25 Nov 2026): the operator sign-in page asks about an invitation only when the browser may hold a
// customer session, so a signed-out visit makes no request that answers 401 (or 503 where accounts are not set up).
describe('customerSessionHinted', () => {
  it('is true only for a non-empty customer session cookie', () => {
    expect(customerSessionHinted([])).toBe(false);
    expect(
      customerSessionHinted([{ name: '__Secure-neon-auth.session_token', value: 'opaque' }]),
    ).toBe(true);
    expect(customerSessionHinted([{ name: 'neon-auth.session_token', value: 'opaque' }])).toBe(
      true,
    );
    expect(customerSessionHinted([{ name: '__Secure-neon-auth.session_token', value: '' }])).toBe(
      false,
    );
  });
  it('never takes a team session, its marker or another Better Auth cookie for a customer session', () => {
    for (const name of [
      'better-auth.session_token',
      '__Secure-better-auth.session_token',
      'corridra-team',
      '__Secure-neon-auth.session_data',
      'neon-auth.two_factor',
      'x-neon-auth.session_token',
      '__Secure-neon-auth.session_token.extra',
    ])
      expect(customerSessionHinted([{ name, value: '1' }]), name).toBe(false);
  });
  it('the sign-in page draws the invitation hint only behind that check', () => {
    const page = readFileSync(resolve('apps/web/app/operator/signin/page.tsx'), 'utf8');
    expect(page).toContain(
      'customerSessionHinted((await cookies()).getAll()) ? <OperatorInvitationHint /> : null',
    );
    expect(page.match(/<OperatorInvitationHint/g)).toHaveLength(1);
  });
});
