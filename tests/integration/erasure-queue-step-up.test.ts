import { describe, expect, test } from 'vitest';
import { isStepUpRequired, withStepUp } from '../../apps/web/lib/ux/step-up';

// staff-core-26: the erasure list asks for the code in place (withStepUp) instead of ending in a dead-end message.
// Held in a variable so the root type check does not follow a .tsx file (it has no JSX setting).
const screen = '../../apps/web/app/operator/erasure-queue';
const { answered, readFailureText } = (await import(/* @vite-ignore */ screen)) as {
  answered: (response: Response) => Promise<Response>;
  readFailureText: (error: unknown) => string;
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('the erasure queue answers', () => {
  test('a lapsed check keeps its code, so the in-place check opens', async () => {
    const refusal = await answered(reply(401, { code: 'STEP_UP_REQUIRED' })).catch((e) => e);
    expect(isStepUpRequired(refusal)).toBe(true);
    expect(refusal.message).toBe('Confirm your code to see and move erasure requests.');
  });
  test('a signed-out 401 and a role refusal are not a request for the code', async () => {
    const signedOut = await answered(reply(401, { error: 'Sign in to continue' })).catch((e) => e);
    expect(isStepUpRequired(signedOut)).toBe(false);
    expect(signedOut.message).toBe('Sign in again to see and move erasure requests.');
    const role = await answered(reply(403, { error: 'Access denied' })).catch((e) => e);
    expect(isStepUpRequired(role)).toBe(false);
    expect(role.status).toBe(403);
    expect(role.message).toBe('Only the workspace owner can manage erasure requests.');
  });
  test('an answer that is ok is passed on untouched', async () => {
    const ok = await answered(reply(200, { items: [], nextAfter: null }));
    expect(await ok.json()).toEqual({ items: [], nextAfter: null });
  });
  test('withStepUp retries once after the check and says what to do when no check is shown', async () => {
    let calls = 0;
    const read = () =>
      withStepUp(() => {
        calls += 1;
        return answered(reply(401, { code: 'STEP_UP_REQUIRED' }));
      });
    // No dialog is mounted here, so the check cannot be passed: one call, and the person is told what to do.
    await expect(read()).rejects.toMatchObject({
      status: 401,
      code: 'STEP_UP_REQUIRED',
      message: 'Confirm your authenticator code to finish this. Your changes are kept.',
    });
    expect(calls).toBe(1);
  });
});

// The visible message on each path of the list read (what the page puts in its status line).
describe('what the list read shows', () => {
  const shown = async (status: number, body: unknown) => {
    const failed = await withStepUp(() => answered(reply(status, body))).catch((e) => e);
    return readFailureText(failed);
  };
  test('a declined check shows the queue\'s own line, never "Your changes are kept."', async () => {
    // No dialog is mounted, so the check is declined.
    expect(await shown(401, { code: 'STEP_UP_REQUIRED' })).toBe(
      'Confirm your code to see and move erasure requests.',
    );
  });
  test('a signed-out 401 shows a sign-in message', async () => {
    expect(await shown(401, { error: 'Sign in to continue' })).toBe(
      'Sign in again to see and move erasure requests.',
    );
  });
  test('a role refusal and a missing queue keep their own words', async () => {
    expect(await shown(403, { error: 'Access denied' })).toBe(
      'Only the workspace owner can manage erasure requests.',
    );
    expect(await shown(503, {})).toBe('The erasure queue is not available yet.');
  });
});
