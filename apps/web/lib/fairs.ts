import type { Fair, FairDate, FairDateKind } from '../content/fairs';

// Fair pages and the Countdown (Lane 12): pure rules, tested without a browser. Nothing here fetches,
// stores or guesses a date. A date is shown only when it has a source, a person and a day of checking.

export const fairDateKinds: readonly FairDateKind[] = ['opens', 'closes', 'registrationCloses'];
export const fairDateWords: Record<FairDateKind, string> = {
  opens: 'Opens',
  closes: 'Closes',
  registrationCloses: 'Registration closes',
};

const day = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar day in YYYY-MM-DD: 2026-02-30 is refused. */
export function isCalendarDay(value: unknown): value is string {
  if (typeof value !== 'string' || !day.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
const https = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 500) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' && !url.username && !url.password && url.hostname.includes('.')
    );
  } catch {
    return false;
  }
};

/** Every reason an entry may not be shown. An empty list means it may. */
export function fairProblems(fair: Fair, today: string): string[] {
  const problems: string[] = [];
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fair.slug) ||
    fair.slug.length < 3 ||
    fair.slug.length > 60
  )
    problems.push('slug');
  if (fair.name.trim().length < 2 || fair.name.length > 160) problems.push('name');
  if (fair.city.trim().length < 1 || fair.city.length > 80) problems.push('city');
  if (!/^[A-Z]{2}$/.test(fair.countryCode)) problems.push('countryCode');
  if (!https(fair.website)) problems.push('website');
  if (fair.dates.length === 0) problems.push('dates');
  const seen = new Set<string>();
  for (const date of fair.dates) {
    const label = `date ${date.kind}`;
    if (!fairDateKinds.includes(date.kind)) problems.push(`${label}: kind`);
    if (seen.has(date.kind)) problems.push(`${label}: repeated`);
    seen.add(date.kind);
    if (date.on !== null && !isCalendarDay(date.on)) problems.push(`${label}: on`);
    if (!https(date.source)) problems.push(`${label}: source`);
    if (date.verifiedBy.trim().length < 2 || date.verifiedBy.length > 80)
      problems.push(`${label}: verifiedBy`);
    if (!isCalendarDay(date.verifiedOn) || date.verifiedOn > today)
      problems.push(`${label}: verifiedOn`);
  }
  const opens = fair.dates.find((d) => d.kind === 'opens')?.on;
  const closes = fair.dates.find((d) => d.kind === 'closes')?.on;
  if (opens && closes && closes < opens) problems.push('closes before it opens');
  return problems;
}

/** The entries that follow every rule. The rest are not shown. */
export function publishableFairs(list: readonly Fair[], today: string): Fair[] {
  const slugs = new Set<string>();
  return list.filter((fair) => {
    if (fairProblems(fair, today).length > 0 || slugs.has(fair.slug)) return false;
    slugs.add(fair.slug);
    return true;
  });
}

/** "Dates last checked": the most recent day any date of the fair was read on its own site. */
export function datesLastChecked(fair: Fair): string | null {
  return (
    fair.dates
      .map((d) => d.verifiedOn)
      .sort()
      .at(-1) ?? null
  );
}

export type Countdown =
  { state: 'future'; days: number } | { state: 'today'; days: 0 } | { state: 'past'; days: number };

/** Whole days from today to a real date. Both are calendar days (UTC), so there is no time zone guess. */
export function countdown(on: string, today: string): Countdown | null {
  if (!isCalendarDay(on) || !isCalendarDay(today)) return null;
  const days = Math.round(
    (Date.parse(`${on}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
  if (days > 0) return { state: 'future', days };
  if (days === 0) return { state: 'today', days: 0 };
  return { state: 'past', days: -days };
}

/**
 * The words for a countdown. A date that has passed is said plainly, and a next possible date is named
 * only when the caller has a real one: the Countdown never invents a replacement.
 */
export function countdownWords(value: Countdown, next?: { on: string } | null): string {
  if (value.state === 'future') return value.days === 1 ? 'Tomorrow' : `In ${value.days} days`;
  if (value.state === 'today') return 'Today';
  const passed =
    value.days === 1 ? 'This date passed yesterday' : `This date passed ${value.days} days ago`;
  return next ? `${passed}. The next date is ${next.on}` : passed;
}

/** The next date of a fair that is still to come (today counts), from the dates the fair has stated. */
export function nextFairDate(fair: Fair, today: string): { kind: FairDateKind; on: string } | null {
  const upcoming = fair.dates
    .filter((d): d is FairDate & { on: string } => d.on !== null && d.on >= today)
    .sort((a, b) => a.on.localeCompare(b.on));
  return upcoming[0] ? { kind: upcoming[0].kind, on: upcoming[0].on } : null;
}
