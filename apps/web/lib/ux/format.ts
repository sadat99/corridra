// One date and time formatter for the whole product (commercial readiness program, D11).
// Full form: "24 Oct 2026, 06:08 (Dhaka, UTC+6)". Date only: "24 Oct 2026".
// Never an ISO string and never a US numeric date. Owner after Wave 0: WS-E (internals only; the
// signatures below are fixed).

export type DateInput = string | number | Date;
export type DateTimeOptions = { timeZone?: string; locale?: string };

let viewerTimeZone: string | undefined;

/** Records the viewer's saved time zone (from their account settings) for every later call. */
export function setViewerTimeZone(zone: string | undefined) {
  viewerTimeZone = zone && isTimeZone(zone) ? zone : undefined;
}

export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The zone used for display: the option, else the viewer's saved zone, else the browser's. */
export function resolveTimeZone(zone?: string): string {
  if (zone && isTimeZone(zone)) return zone;
  if (viewerTimeZone) return viewerTimeZone;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function toDate(value: DateInput): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** English-shaped day, month name and year. Other languages keep the same order and month names. */
function intlLocale(locale?: string) {
  return !locale || locale === 'en' ? 'en-GB' : locale;
}

/** "UTC+6", "UTC-3:30" or "UTC" for the zone at that instant. */
export function utcOffsetLabel(date: Date, zone: string): string {
  const part = new Intl.DateTimeFormat('en-GB', { timeZone: zone, timeZoneName: 'shortOffset' })
    .formatToParts(date)
    .find((p) => p.type === 'timeZoneName')?.value;
  const offset = (part ?? 'GMT').replace(/^GMT/, '');
  return offset ? `UTC${offset}` : 'UTC';
}

/** "Dhaka", "New York" or "UTC": the last part of the zone name in plain words. */
export function timeZoneCity(zone: string): string {
  if (zone === 'UTC' || zone === 'Etc/UTC') return 'UTC';
  return (zone.split('/').pop() ?? zone).replaceAll('_', ' ');
}

/** "Dhaka, UTC+6" or "UTC". */
export function timeZoneLabel(zone: string, at: Date = new Date()): string {
  const city = timeZoneCity(zone);
  const offset = utcOffsetLabel(at, zone);
  return city === 'UTC' ? 'UTC' : `${city}, ${offset}`;
}

export function formatDate(value: DateInput, opts: DateTimeOptions = {}): string {
  const date = toDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat(intlLocale(opts.locale), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: resolveTimeZone(opts.timeZone),
  }).format(date);
}

export function formatDateTime(value: DateInput, opts: DateTimeOptions = {}): string {
  const date = toDate(value);
  if (!date) return '';
  const zone = resolveTimeZone(opts.timeZone);
  const time = new Intl.DateTimeFormat(intlLocale(opts.locale), {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: zone,
  }).format(date);
  return `${formatDate(date, { ...opts, timeZone: zone })}, ${time} (${timeZoneLabel(zone, date)})`;
}

/** "Due today", "Due tomorrow", "Due in 3 days", "1 day overdue", "4 days overdue". */
export function formatRelativeDue(value: DateInput, now: DateInput = Date.now()): string {
  const due = toDate(value),
    current = toDate(now);
  if (!due || !current) return '';
  const zone = resolveTimeZone();
  const day = (d: Date) => {
    const [y, m, dd] = new Intl.DateTimeFormat('en-CA', { timeZone: zone })
      .format(d)
      .split('-')
      .map(Number);
    return Date.UTC(y!, m! - 1, dd!) / 86400000;
  };
  const days = day(due) - day(current);
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days > 1) return `Due in ${days} days`;
  return days === -1 ? '1 day overdue' : `${-days} days overdue`;
}

/**
 * Converts a wall-clock time typed in a zone ("2026-10-24T06:08" in Asia/Dhaka) to an exact instant
 * as an ISO string for storage. Returns null for an empty or invalid value.
 */
export function zonedWallTimeToIso(wall: string, zone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(wall);
  if (!m || !isTimeZone(zone)) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as number[];
  const guess = Date.UTC(y!, mo! - 1, d!, h!, mi!);
  // Two passes settle the offset, including across a daylight saving change.
  let instant = guess;
  for (let pass = 0; pass < 2; pass++) instant = guess - zoneOffsetMs(new Date(instant), zone);
  return new Date(instant).toISOString();
}

/** The inverse: the wall-clock "YYYY-MM-DDTHH:mm" an instant shows in a zone, for an input value. */
export function isoToZonedWallTime(value: DateInput, zone: string): string {
  const date = toDate(value);
  if (!date || !isTimeZone(zone)) return '';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function zoneOffsetMs(date: Date, zone: string): number {
  const wall = isoToZonedWallTime(date, zone);
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(wall)!;
  const [, y, mo, d, h, mi] = m.map(Number) as number[];
  return Date.UTC(y!, mo! - 1, d!, h!, mi!) - Math.floor(date.getTime() / 60000) * 60000;
}
