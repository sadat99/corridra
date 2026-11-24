// Server side of journey modes: the one place the mode cookie is read. It never writes (the browser writes the
// cookie) and never throws: with the switch off, or a cookie that cannot be read, there is no mode or Everything.
import { cookies } from 'next/headers';
import { journeyModesOn } from './journey-modes-on';
import {
  journeyModeCookie,
  parseJourneyMode,
  resolveJourneyMode,
  type JourneyMode,
} from './journey-mode';

/** The mode the cookie holds, through the closed list. */
export async function readJourneyMode(): Promise<JourneyMode> {
  try {
    return parseJourneyMode((await cookies()).get(journeyModeCookie)?.value);
  } catch {
    return 'all';
  }
}

/**
 * The mode a page is in: null while the switch is off (the page is then exactly what it was), otherwise the page's
 * own word, then the cookie, then Everything. The cookie is not read when the page already says.
 */
export async function activeJourneyMode(
  explicit?: JourneyMode | null,
): Promise<JourneyMode | null> {
  if (!journeyModesOn()) return null;
  return explicit ?? resolveJourneyMode({ cookie: await readJourneyMode() });
}
