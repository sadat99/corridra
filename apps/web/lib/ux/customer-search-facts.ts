// The customer search answer and its check (docs/revamp/specs/navigation-v1/customer-search.md, section 3). Pure and
// shared: the server builds hits and addresses with the helpers here, the browser reads an answer back through
// `parseFound`, which accepts only the addresses and shapes the server can send. Nothing here reads data or grants
// access, and nothing says "verified": a fact is only what the person's own services already returned.

export type CustomerHitKind = 'request' | 'company';
/** `expired` is never sent by the server: the dialog sets it on Companies when it has cleared them. */
export type ScopeState =
  'ok' | 'partial' | 'unavailable' | 'denied' | 'archived' | 'limited' | 'expired';
export type CustomerScopeName = 'requests' | 'companies';
/** The states the server may send. */
export const scopeStates: readonly ScopeState[] = [
  'ok',
  'partial',
  'unavailable',
  'denied',
  'archived',
  'limited',
];

export type CustomerHit = {
  id: string;
  label: string;
  detail: string;
  href: string;
  kind: CustomerHitKind;
  /** Set only when the hit comes from sample data, which is always labelled as such. */
  sample?: true;
};
/** Beside a hit, keyed `request:<uuid>` or `company:<hex64>`. A Request has `sent`; a Company has `reports`. */
export type CustomerFacts = {
  sent?: string;
  status?: string;
  withdrawn?: true;
  reports?: number;
  close?: true;
};
export type CustomerFound = {
  hits: CustomerHit[];
  scopes: Partial<Record<CustomerScopeName, ScopeState>>;
  facts: Record<string, CustomerFacts>;
  /** When the approved scope behind the company hits expires (ISO), null for no expiry, absent when Companies were not read. */
  expiresAt?: string | null;
};

/** At most this many hits per scope are read from an answer, whatever the server sends. */
export const foundHitLimit = 10;
/** Labels and details are cut to this many UTF-16 units. */
export const textLimit = 200;
const uuidPart = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const requestId = new RegExp(`^${uuidPart}$`, 'i');
const companyId = /^[0-9a-f]{64}$/;
const requestAddress = new RegExp(`^/account/requests/${uuidPart}$`, 'i');
const reportAddress = new RegExp(`^/account/missions/${uuidPart}$`, 'i');
const statusShape = /^[A-Z][A-Z_]{0,31}$/;
const sentLimit = 40;
const reportLimit = 1000;

/** A Request id or a report id: a UUID. */
export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && requestId.test(value);
/** A Company id: the 64 hexadecimal characters of the portfolio's hashed identity key. */
export const isCompanyId = (value: unknown): value is string =>
  typeof value === 'string' && companyId.test(value);

/** The status of a Request as the service stores it, or undefined for anything that is not shaped like one. */
export function statusWord(value: unknown): string | undefined {
  return typeof value === 'string' && statusShape.test(value) ? value : undefined;
}

/** Where a Request hit opens. */
export const requestHref = (id: string) => `/account/requests/${id}`;
/** Where a Company hit opens: the private report page of its first approved context. */
export const reportHref = (resourceId: string) => `/account/missions/${resourceId}`;

/** The first 200 characters, without cutting a surrogate pair in two (no ellipsis: it would join the accessible name). */
export function cutText(value: string): string {
  if (value.length <= textLimit) return value;
  const code = value.charCodeAt(textLimit - 1);
  return value.slice(0, code >= 0xd800 && code <= 0xdbff ? textLimit - 1 : textLimit);
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function hitOf(item: unknown): CustomerHit | null {
  if (!record(item)) return null;
  const { id, label, detail, href, kind, sample } = item;
  if (typeof id !== 'string' || typeof label !== 'string' || typeof href !== 'string') return null;
  if (kind === 'request') {
    if (!requestId.test(id) || !requestAddress.test(href)) return null;
    if (href.slice(href.lastIndexOf('/') + 1).toLowerCase() !== id.toLowerCase()) return null;
  } else if (kind === 'company') {
    if (!companyId.test(id) || !reportAddress.test(href)) return null;
  } else return null;
  // A long name is shown cut, not dropped: the match may have come from it.
  return {
    id,
    label: cutText(label),
    detail: typeof detail === 'string' ? cutText(detail) : '',
    href,
    kind,
    ...(sample === true ? { sample: true as const } : {}),
  };
}

function factsOf(kind: CustomerHitKind, raw: Record<string, unknown>): CustomerFacts | null {
  const fact: CustomerFacts = {};
  if (kind === 'request') {
    if (typeof raw.sent !== 'string' || raw.sent.length > sentLimit) return null;
    if (!Number.isFinite(Date.parse(raw.sent))) return null;
    fact.sent = raw.sent;
    const status = statusWord(raw.status);
    if (status) fact.status = status;
    if (raw.withdrawn === true) fact.withdrawn = true;
  } else {
    if (!Number.isInteger(raw.reports)) return null;
    const reports = raw.reports as number;
    if (reports < 0 || reports > reportLimit) return null;
    fact.reports = reports;
  }
  if (raw.close === true) fact.close = true;
  return fact;
}

const factKey = (kind: CustomerHitKind, id: string) => `${kind}:${id.toLowerCase()}`;

/**
 * The search answer, checked. Returns null when it is not an answer at all (the caller then shows the search as
 * failed). A hit with a wrong id, a wrong address or another kind's shape is dropped; a scope name or state that is
 * not known is ignored.
 */
export function parseFound(value: unknown): CustomerFound | null {
  if (!record(value) || !Array.isArray(value.hits) || !record(value.scopes)) return null;
  const scopes: CustomerFound['scopes'] = {};
  for (const name of ['requests', 'companies'] as const) {
    const state = value.scopes[name];
    if (typeof state === 'string' && (scopeStates as readonly string[]).includes(state))
      scopes[name] = state as ScopeState;
  }
  const taken: Record<CustomerHitKind, number> = { request: 0, company: 0 };
  const seen = new Set<string>();
  const hits: CustomerHit[] = [];
  for (const item of value.hits) {
    const hit = hitOf(item);
    if (!hit || taken[hit.kind] === foundHitLimit) continue;
    const key = factKey(hit.kind, hit.id);
    if (seen.has(key)) continue;
    seen.add(key);
    taken[hit.kind] += 1;
    hits.push(hit);
  }
  const facts: Record<string, CustomerFacts> = {};
  if (record(value.facts))
    for (const hit of hits) {
      const raw = Object.entries(value.facts).find(
        ([key]) => key.toLowerCase() === factKey(hit.kind, hit.id),
      )?.[1];
      const fact = record(raw) ? factsOf(hit.kind, raw) : null;
      if (fact) facts[factKey(hit.kind, hit.id)] = fact;
    }
  const expiry =
    value.expiresAt === null
      ? null
      : typeof value.expiresAt === 'string' &&
          value.expiresAt.length <= sentLimit &&
          Number.isFinite(Date.parse(value.expiresAt))
        ? value.expiresAt
        : undefined;
  return { hits, scopes, facts, ...(expiry !== undefined ? { expiresAt: expiry } : {}) };
}

/** Looks a hit's facts up, whatever the case of the id. */
export function factFor(found: CustomerFound | null, hit: CustomerHit): CustomerFacts | undefined {
  return found?.facts[factKey(hit.kind, hit.id)];
}
