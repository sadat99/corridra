// The programme a visitor chose to apply to, kept in this browser so the choice survives sign-up, email
// verification and sign-in. Navigation only: it holds a public address and a public title, never access.
export const applyIntentKey = 'corridra.programme-apply';
const week = 7 * 24 * 3600 * 1000;
const address = /^[a-z0-9]+(-[a-z0-9]+)*-[a-z0-9]{10}$/;
export type ApplyIntent = { address: string; title: string; savedAt: number };

export function saveApplyIntent(intent: { address: string; title: string }) {
  try {
    window.localStorage.setItem(
      applyIntentKey,
      JSON.stringify({
        address: intent.address,
        title: intent.title.slice(0, 160),
        savedAt: Date.now(),
      }),
    );
  } catch {
    /* Storage can be unavailable; the address still carries the choice while the person stays signed in. */
  }
}
export function readApplyIntent(now = Date.now()): ApplyIntent | null {
  try {
    const raw = window.localStorage.getItem(applyIntentKey);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<ApplyIntent>;
    if (
      typeof v.address !== 'string' ||
      v.address.length > 80 ||
      !address.test(v.address) ||
      typeof v.title !== 'string' ||
      typeof v.savedAt !== 'number' ||
      now - v.savedAt > week ||
      v.savedAt > now + 60000
    ) {
      window.localStorage.removeItem(applyIntentKey);
      return null;
    }
    return { address: v.address, title: v.title, savedAt: v.savedAt };
  } catch {
    return null;
  }
}
export function clearApplyIntent() {
  try {
    window.localStorage.removeItem(applyIntentKey);
  } catch {
    /* Nothing to clear. */
  }
}
