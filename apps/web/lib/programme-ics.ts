// The calendar file of a public programme page (ADR-084 S1). It is built only from words the organiser published and the
// start and end days the organiser chose to state for that version. It names no person, carries no email address and no
// attendee, and is the same bytes for the same page version, so a second download never makes a second event. The event
// id belongs to the page, not to a version, and SEQUENCE is the published version: a calendar that already holds the event
// updates it when the organiser publishes again, instead of adding a second one.
export type CalendarInput = {
  address: string;
  version: number;
  title: string;
  destination: string;
  startsOn: string;
  endsOn: string;
  /** When this version of the page was published (ISO). Used as the stamp, so the file does not change between downloads. */
  publishedAt: string;
  url: string;
  sample: boolean;
};

// A real calendar day: 2027-02-31 is refused, not moved to March.
const isDay = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
};
const compactDay = (value: string) => value.replaceAll('-', '');
const compactTime = (iso: string) =>
  new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
const nextDay = (value: string) =>
  new Date(Date.parse(`${value}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

/** Text values: backslash, semicolon, comma and line breaks are escaped, as RFC 5545 asks. The three Unicode line
 * separators (U+2028, U+2029, U+0085) are not line breaks in RFC 5545 but some calendars split on them, so they become a space. */
export const icsText = (value: string) =>
  value
    .replace(/[\u2028\u2029\u0085]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');

/** A content line folded at 75 octets, never inside a multi-byte character, continuation lines starting with a space. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const out: string[] = [];
  let current = '';
  let size = 0;
  let limit = 75;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (size + bytes > limit) {
      out.push(current);
      current = ' ';
      size = 1;
      limit = 75;
    }
    current += char;
    size += bytes;
  }
  out.push(current);
  return out.join('\r\n');
}

/** The file, or null when the stated days are not a valid range. One all-day event, the end day included. */
export function programmeCalendar(input: CalendarInput): string | null {
  if (!isDay(input.startsOn) || !isDay(input.endsOn) || input.endsOn < input.startsOn) return null;
  const label = input.sample ? `Sample: ${input.title}` : input.title;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Corridra//Programme page//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${input.address}@${new URL(input.url).hostname}`,
    `SEQUENCE:${input.version}`,
    `DTSTAMP:${compactTime(input.publishedAt)}`,
    `DTSTART;VALUE=DATE:${compactDay(input.startsOn)}`,
    // An all-day event ends on the day after its last day.
    `DTEND;VALUE=DATE:${compactDay(nextDay(input.endsOn))}`,
    `SUMMARY:${icsText(label)}`,
    `LOCATION:${icsText(input.destination)}`,
    `DESCRIPTION:${icsText(`Stated by the organiser and not checked by Corridra. Details and how to apply: ${input.url}`)}`,
    `URL:${input.url}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
