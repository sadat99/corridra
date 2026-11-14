/**
 * Keeps an installed Corridra on the newest worker without ever interrupting the person.
 *
 * A browser checks for a new worker file on its own schedule, which for an installed app that stays open or
 * is reopened from the home screen can be slow. This asks it to check when the page loads and again when the
 * page becomes visible, at most once every ten minutes. It never reloads the page, shows nothing and stores
 * nothing on the device: the time of the last check lives only in this page's memory.
 */

/** The shortest time between two checks made by this page. */
export const updateCheckIntervalMs = 10 * 60 * 1000;

/** True when no check has been made yet, the clock went backwards, or the interval has passed. */
export function shouldCheckForUpdate(
  lastCheck: number | null,
  now: number,
  interval: number = updateCheckIntervalMs,
): boolean {
  return lastCheck === null || now < lastCheck || now - lastCheck >= interval;
}

type Updatable = { update(): Promise<unknown> };
type Page = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;

/**
 * Checks for a new worker now, then whenever the page becomes visible again and the interval has passed.
 * Returns the function that stops watching. A failed check (for example while offline) is ignored.
 */
export function keepWorkerCurrent(
  registration: Updatable,
  page: Page,
  now: () => number = Date.now,
): () => void {
  let lastCheck: number | null = null;
  const check = () => {
    lastCheck = now();
    try {
      void Promise.resolve(registration.update()).catch(() => {});
    } catch {
      // The website works the same without an update check.
    }
  };
  const onVisibilityChange = () => {
    if (page.visibilityState === 'visible' && shouldCheckForUpdate(lastCheck, now())) check();
  };
  check();
  page.addEventListener('visibilitychange', onVisibilityChange);
  return () => page.removeEventListener('visibilitychange', onVisibilityChange);
}
