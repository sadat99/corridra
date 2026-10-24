// The Room: one request in one place. Pure helpers, tested without a browser. The emblem is built from
// the request's own words, never stock imagery, so the same request always looks the same and nothing
// has to be stored or fetched for it.

export type Emblem = { initials: string; tone: 0 | 1 | 2 | 3 };

/** Initials from the first two words (two letters from one word), and one of four fixed tones from a stable hash. */
export function emblemFor(name: string): Emblem {
  const words = name
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const first = [...(words[0] ?? '?')];
  const second = [...(words[1] ?? '')];
  const initials = (
    second.length ? first[0] + second[0] : first.slice(0, 2).join('')
  ).toLocaleUpperCase();
  let hash = 0;
  for (const char of name.normalize('NFKC')) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return { initials, tone: (hash % 4) as Emblem['tone'] };
}

export type RoomLink = {
  /** A delivered report exists for this request and the person may read it. */
  reportAvailable: boolean;
  /** The saved report's id, once the person saved it. */
  savedResourceId: string | null;
};

type Assignment = {
  id?: unknown;
  requestId?: unknown;
  available?: unknown;
  savedResourceId?: unknown;
};

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

/**
 * What the assigned missions say about one request. Only a readable, available assignment for this
 * exact request counts; a malformed row is ignored, never trusted. A saved report is preferred.
 */
export function roomLinkFor(requestId: string, assignments: unknown): RoomLink {
  const rows = Array.isArray(assignments) ? (assignments as Assignment[]) : [];
  let reportAvailable = false;
  let savedResourceId: string | null = null;
  for (const row of rows) {
    if (!row || row.requestId !== requestId || row.available !== true) continue;
    reportAvailable = true;
    if (typeof row.savedResourceId === 'string' && uuid.test(row.savedResourceId))
      savedResourceId ??= row.savedResourceId;
  }
  return { reportAvailable, savedResourceId };
}

/** The records the Road may read for Compare and Decide. A decision is not readable here, so it is never claimed. */
export function roadRecords(link: RoomLink) {
  return { compare: link.reportAvailable, decide: false };
}
