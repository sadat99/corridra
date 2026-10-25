import { countdown, countdownWords } from '../lib/fairs';

/**
 * Days to a real date. It draws nothing unless it is given a real calendar day, so a screen with no
 * date has no countdown at all. Today is passed in by the page (a server render), so the words can
 * never disagree between the server and the browser, and no script is needed.
 */
export function Countdown({
  on,
  today,
  next = null,
}: {
  on: string | null;
  today: string;
  /** A real next date to name once this one has passed. Leave out when there is none. */
  next?: { on: string } | null;
}) {
  if (!on) return null;
  const value = countdown(on, today);
  if (!value) return null;
  return (
    <span className="countdown" data-state={value.state}>
      {countdownWords(value, next)}
    </span>
  );
}
