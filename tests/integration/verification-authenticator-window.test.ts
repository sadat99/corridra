import { describe, expect, it } from 'vitest';
import { codeWaitMs, codeWindow, totp } from '../e2e/verification/fixtures';

// The sign-in helper of the verification suite (tests/e2e/verification/fixtures.ts, signInOwner) may use a code
// only once per 30 second window and must record the window it really used. Run with forced clocks here, without a
// browser. A fixed key makes the codes the same on every run.
const secret = 'JBSWY3DPEHPK3PXP';
const window = 30000;
const margin = 3000;
/** The moment a helper that waits `codeWaitMs` until it is 0 would use. */
function chosenTime(now: number, lastWindow: number) {
  let at = now;
  for (let wait = codeWaitMs(at, lastWindow); wait > 0; wait = codeWaitMs(at, lastWindow))
    at += wait;
  return at;
}

describe('choosing the moment for an authenticator code', () => {
  it('uses the moment as it is when it is early in a window after the last one used', () => {
    expect(codeWaitMs(0.1 * 1000 + 5 * window, 3)).toBe(0);
    expect(codeWaitMs(7 * window + 2000, 3)).toBe(0);
  });
  it('waits for the next window when 29.9 seconds of the window are gone, never using the last 3 seconds', () => {
    const now = 5 * window + 29900;
    expect(codeWaitMs(now, 4)).toBe(100);
    expect(chosenTime(now, 4)).toBe(6 * window);
    expect(codeWindow(chosenTime(now, 4))).toBe(6);
  });
  it('uses a code 0.1 seconds into a window that is after the last one', () => {
    const now = 5 * window + 100;
    expect(chosenTime(now, 4)).toBe(now);
  });
  it('waits for the next window when the window is the last one used, and for the one after when an earlier window is claimed to be later', () => {
    const now = 5 * window + 100;
    expect(codeWaitMs(now, 5)).toBe(window - 100);
    expect(codeWindow(chosenTime(now, 5))).toBe(6);
    // The last window recorded is ahead of the clock (a clock that went back): still a window after it.
    expect(codeWindow(chosenTime(now, 7))).toBe(8);
  });
  it('uses an earlier last window without waiting', () => {
    const now = 5 * window + 10000;
    expect(codeWaitMs(now, 2)).toBe(0);
    expect(codeWaitMs(now, 0)).toBe(0);
  });
  it('never uses the last 3 seconds of a window, a window already used, or waits longer than one window, at any time in four windows', () => {
    for (let now = 4 * window; now < 8 * window; now += 97)
      for (const last of [codeWindow(now) - 2, codeWindow(now) - 1, codeWindow(now)]) {
        const at = chosenTime(now, last);
        expect(codeWindow(at), `${now} after ${last}`).toBeGreaterThan(last);
        expect((codeWindow(at) + 1) * window - at, `${now} after ${last}`).toBeGreaterThanOrEqual(
          margin,
        );
        expect(at - now, `${now} after ${last}`).toBeLessThanOrEqual(window);
        expect(codeWaitMs(at, last)).toBe(0);
      }
  });
  it('makes the code of the recorded window, because both come from the one moment', () => {
    const now = 5 * window + 29900;
    const at = chosenTime(now, 4);
    const recorded = codeWindow(at);
    expect(totp(secret, at)).toBe(totp(secret, recorded * window));
    expect(totp(secret, at)).toBe(totp(secret, recorded * window + window - 1));
  });
  it('shows what the old helper did: the window it recorded was not the window of its code', () => {
    // The old helper read the clock once for the recorded window and again inside totp(secret).
    const firstRead = 5 * window + 29999;
    const secondRead = 6 * window + 1;
    const recordedOld = Math.floor(firstRead / window);
    expect(recordedOld).toBe(5);
    expect(totp(secret, secondRead)).toBe(totp(secret, 6 * window));
    expect(totp(secret, secondRead)).not.toBe(totp(secret, recordedOld * window));
    // The next run would take window 6 as unused and its code would be refused. The new helper cannot split them.
    const at = chosenTime(firstRead, 4);
    expect(codeWindow(at)).toBe(6);
    expect(totp(secret, at)).toBe(totp(secret, 6 * window));
  });
});
