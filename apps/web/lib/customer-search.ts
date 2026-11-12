// The customer search (docs/revamp/specs/navigation-v1/customer-search.md). It reads a person's own Requests and
// approved Companies only through the services they already use, each of which runs under that person's own session
// and row security, so it can show nothing the person could not already open. It reads a bounded number of rows
// (customerSearchLimits), ranks what it read in memory (palette-rank.ts) and returns a label, a detail, an address and a
// few facts per hit. The typed words exist only in this module's arguments: they are never passed to a service, a
// database, a log or a header. It writes no search data (the session boundary writes its short session proof rows, as for every customer read). A scope that cannot be read says so; it is never an empty list.
import { DomainError } from '@corridra/domain';
import { archivedWorkspaceRefusal } from '@corridra/auth/customer-workspace-lifecycle';
import { requestTitle } from '../app/account/request-words';
import { createSearchLimit, type SearchAllowance } from './search-limit';
import { queryWords, rankFields } from './palette-rank';
import {
  cutText,
  isCompanyId,
  isUuid,
  reportHref,
  requestHref,
  statusWord,
  type CustomerFacts,
  type CustomerHit,
  type CustomerScopeName,
  type ScopeState,
} from './ux/customer-search-facts';

export const customerSearchScopes = ['all', 'requests', 'companies'] as const;
export type CustomerSearchScope = (typeof customerSearchScopes)[number];

/**
 * Work per search. Requests: one page of 100 saved Requests, then at most 30 title lookups, two at a time, within 6
 * seconds, stopping after 3 failures in a row. Companies: up to 4 pages of 5 approved report scopes. Scopes run one
 * after the other. showAll hits per scope under All, showScope for a single scope. One search never holds more than
 * searchDeadlineMs overall, one process runs at most maxConcurrentSearches searches at once, and one person may start
 * perPersonSearches searches in each perPersonWindowMs (10 in 10 seconds, a third of the staff palette's 30, because a search
 * here can make up to 35 service calls).
 */
export const customerSearchLimits = {
  requestPage: 100,
  titleCap: 30,
  titleConcurrency: 2,
  titleBudgetMs: 6000,
  titleFailureStop: 3,
  companyPages: 4,
  companyPageSize: 5,
  showAll: 5,
  showScope: 10,
  maxConcurrentSearches: 4,
  searchDeadlineMs: 12000,
  perPersonSearches: 10,
  perPersonWindowMs: 10000,
  perPersonKeys: 5000,
} as const;

const personLimit = createSearchLimit({
  searches: customerSearchLimits.perPersonSearches,
  windowMs: customerSearchLimits.perPersonWindowMs,
  maxKeys: customerSearchLimits.perPersonKeys,
});
/**
 * Counts one search for this person. The key must be the signed-in person from the server-side provider session, never a
 * value the browser sent. In process, so per server instance; its own map, so a staff search never spends it.
 */
export function spendPersonSearch(key: string, now?: number): SearchAllowance {
  return personLimit.spend(key, now);
}
/** How many people the limit holds (a test checks that it stays bounded). */
export const personLimitSize = () => personLimit.size();
/** For tests only: forget every count. */
export const resetPersonLimit = () => personLimit.reset();

let activeSearches = 0;
/**
 * Takes one of the process's search slots, or returns null when all are taken. Every search costs several remote
 * identity checks and held database connections, so a burst of searches must not starve the rest of the application.
 * The caller releases the slot in a finally block.
 */
export function takeSearchSlot(): (() => void) | null {
  if (activeSearches >= customerSearchLimits.maxConcurrentSearches) return null;
  activeSearches += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeSearches -= 1;
  };
}

type Read = (value: unknown, subject?: string, issuer?: string) => Promise<unknown>;
export type CustomerSearchServices = {
  requests: { list: Read };
  details: { detail: Read };
  companies: { list: Read };
  /**
   * The budget the Companies page spends before every portfolio page it reads (the same per-client allowance, in the mode
   * the deployment is in). A refusal is a DomainError 429. The search spends it before every page it reads, so a person
   * refused on the Companies page cannot read the portfolio through search.
   */
  companyBudget: (client: string) => Promise<void>;
};
export type CustomerSearchSwitches = {
  /** The Requests module is on. */
  requests: boolean;
  /** The request details module is on: titles come from it, so Requests cannot be searched without it. */
  details: boolean;
  /** The approved Companies module is on. */
  companies: boolean;
  /** True when the data's provenance may be shown in this environment. */
  provenance: (synthetic: unknown) => boolean;
};
export type CustomerSearchContext = {
  /** Rejection-only: the browser's claim of who it is, which the session boundary checks and never trusts. */
  subject?: string;
  issuer?: string;
  correlationId: string;
  /** The client the Companies budget counts, derived by the route exactly as the Companies route derives it. */
  client: string;
  /** The request's own signal: when it aborts, no further lookup or page is started and a call in flight is given up on. */
  signal?: AbortSignal;
  /** The clock for the title time budget; replaced in tests. */
  now?: () => number;
};
export type CustomerSearchAnswer = {
  hits: CustomerHit[];
  scopes: Partial<Record<CustomerScopeName, ScopeState>>;
  facts?: Record<string, CustomerFacts>;
};

type Candidate = {
  id: string;
  position: number;
  score: number;
  close: boolean;
  hit: CustomerHit;
  key: string;
  facts: CustomerFacts;
};
type Found = { state: ScopeState; candidates: Candidate[] };

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const none = (state: ScopeState): Found => ({ state, candidates: [] });
const sqlState = (error: unknown) => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
};
const missingModule = new Set(['42P01', '3F000', '42883']);

/** Best score first, then the order the service gave the rows, then the id by plain code unit. */
function inOrder(a: Candidate, b: Candidate) {
  return b.score - a.score || a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** A refusal that ends the whole search: not signed in, not allowed, a bad claim, or a bad request. */
export const endsSearch = (error: unknown): error is DomainError =>
  error instanceof DomainError && [400, 401, 403, 409].includes(error.status);

/**
 * What a first read that failed means for its scope, or undefined when the failure is not one the person can be told
 * about (the caller then lets it end the search as a generic failure).
 */
function scopeFailure(error: unknown, scope: CustomerScopeName): ScopeState | undefined {
  if (scope === 'requests' && archivedWorkspaceRefusal(error)) return 'archived';
  if (error instanceof DomainError) {
    if (error.status === 503) return 'unavailable';
    return error.status === 429 ? 'limited' : undefined;
  }
  const code = sqlState(error);
  if (code && missingModule.has(code)) return 'unavailable';
  if (code === '42501') return 'denied';
  return undefined;
}

/**
 * The only parts of an error a log line may carry: its kind and its code, capped. Never the message, which a database
 * may fill with the words that were typed.
 */
export function errorFacts(error: unknown): { errorName?: string; errorCode?: string | number } {
  const name = error instanceof Error && error.name.length <= 64 ? error.name : undefined;
  const raw = (error as { code?: unknown } | null)?.code;
  const code =
    (typeof raw === 'string' || typeof raw === 'number') && String(raw).length <= 32
      ? raw
      : undefined;
  return { errorName: name, errorCode: code };
}

const failedIn = new WeakMap<object, CustomerScopeName>();
/** Remembers which scope an unexpected failure came from, so the route can log it. Returns the same error. */
function failed(error: unknown, scope: CustomerScopeName): unknown {
  if (typeof error === 'object' && error !== null) failedIn.set(error, scope);
  return error;
}
/** The scope an unexpected failure came from, when the core knows it. */
export const failedScope = (error: unknown): CustomerScopeName | undefined =>
  typeof error === 'object' && error !== null ? failedIn.get(error) : undefined;

/** One fixed line for a scope that failed after another scope had answered: the kind and code of the error, never its message. */
function scopeFailed(scope: CustomerScopeName, correlationId: string, error: unknown) {
  console.error(
    JSON.stringify({
      event: 'customer_search_scope_failed',
      scope,
      correlationId,
      ...errorFacts(error),
    }),
  );
}

function pageFailed(page: number, correlationId: string, error: unknown) {
  console.error(
    JSON.stringify({
      event: 'customer_search_page_failed',
      scope: 'companies',
      page,
      correlationId,
      ...errorFacts(error),
    }),
  );
}

class DeadlineReached extends Error {}
type Guard = {
  now: () => number;
  /** True once the request has aborted or the overall deadline has passed. */
  expired: () => boolean;
  /** Runs one service call, giving up on it (DeadlineReached) when the request aborts or the deadline passes. */
  bounded: <T>(run: () => Promise<T>) => Promise<T>;
};
function guardFor(context: CustomerSearchContext): Guard {
  const now = context.now ?? Date.now;
  const started = now();
  const left = () => customerSearchLimits.searchDeadlineMs - (now() - started);
  const expired = () => context.signal?.aborted === true || left() <= 0;
  const bounded = <T>(run: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      if (expired()) return reject(new DeadlineReached());
      const stop = () => reject(new DeadlineReached());
      const timer = setTimeout(stop, left());
      context.signal?.addEventListener('abort', stop, { once: true });
      run()
        .then(resolve, reject)
        .finally(() => {
          clearTimeout(timer);
          context.signal?.removeEventListener('abort', stop);
        });
    });
  return { now, expired, bounded };
}

type RequestRow = {
  id: string;
  sent: string;
  status?: string;
  withdrawn: boolean;
  sample: boolean;
};

async function findRequests(
  services: CustomerSearchServices,
  switches: CustomerSearchSwitches,
  context: CustomerSearchContext,
  guard: Guard,
  words: string[],
): Promise<Found> {
  const limits = customerSearchLimits;
  if (!switches.requests || !switches.details) return none('unavailable');
  let page: unknown;
  try {
    page = await guard.bounded(() =>
      services.requests.list({ pageSize: limits.requestPage }, context.subject, context.issuer),
    );
  } catch (error) {
    // Out of time before the first answer: nothing was searched, and that is said as partial, never as "ok".
    if (error instanceof DeadlineReached) return none('partial');
    const state = scopeFailure(error, 'requests');
    if (!state) throw failed(error, 'requests');
    return none(state);
  }
  if (!record(page) || !Array.isArray(page.requests) || !switches.provenance(page.synthetic))
    return none('unavailable');
  // More saved Requests than one page holds: the rest are not read.
  let partial = page.nextAfter !== null && page.nextAfter !== undefined;
  const rows: RequestRow[] = [];
  for (const row of page.requests.slice(0, limits.requestPage)) {
    // A Request whose retention has ended is not searchable and is not "partial": there is nothing to find.
    if (record(row) && row.available === false) continue;
    const sent = record(row) && typeof row.createdAt === 'string' ? Date.parse(row.createdAt) : NaN;
    if (!record(row) || row.available !== true || !isUuid(row.id) || Number.isNaN(sent)) {
      partial = true;
      continue;
    }
    const progress = record(row.progress) ? row.progress : {};
    rows.push({
      id: row.id.toLowerCase(),
      sent: new Date(sent).toISOString(),
      status: statusWord(progress.status),
      withdrawn: row.withdrawn === true,
      sample: row.synthetic === true,
    });
  }
  if (page.requests.length > limits.requestPage) partial = true;

  const lookups = rows.slice(0, limits.titleCap);
  if (rows.length > lookups.length) partial = true;
  const started = guard.now();
  const titles = new Map<string, string>();
  let next = 0;
  let consecutive = 0;
  let stopped = false;
  const ended: { refusal?: DomainError; denied?: boolean } = {};
  const worker = async () => {
    while (!stopped && next < lookups.length) {
      if (guard.expired() || guard.now() - started >= limits.titleBudgetMs) {
        partial = true;
        stopped = true;
        return;
      }
      const row = lookups[next++]!;
      try {
        const detail = await guard.bounded(() =>
          services.details.detail(row.id, context.subject, context.issuer),
        );
        consecutive = 0;
        const title = requestTitle(record(detail) ? detail.original : undefined);
        if (title) titles.set(row.id, title);
      } catch (error) {
        if (endsSearch(error)) {
          ended.refusal ??= error;
          stopped = true;
          return;
        }
        // A person whose access ended while the titles were read gets nothing from this scope.
        if (sqlState(error) === '42501') {
          ended.denied = true;
          stopped = true;
          return;
        }
        partial = true;
        if (error instanceof DeadlineReached) {
          stopped = true;
          return;
        }
        consecutive += 1;
        if (consecutive >= limits.titleFailureStop) stopped = true;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limits.titleConcurrency, lookups.length) }, worker),
  );
  if (ended.refusal) throw ended.refusal;
  if (ended.denied) return none('denied');

  const candidates: Candidate[] = [];
  rows.forEach((row, index) => {
    const title = titles.get(row.id);
    const ranked = title ? rankFields(words, [{ value: title, label: true }]) : null;
    if (!title || !ranked) return;
    const facts: CustomerFacts = { sent: row.sent };
    if (row.status) facts.status = row.status;
    if (row.withdrawn) facts.withdrawn = true;
    if (ranked.close) facts.close = true;
    candidates.push({
      id: row.id,
      position: index,
      score: ranked.score,
      close: ranked.close,
      key: `request:${row.id}`,
      facts,
      hit: {
        id: row.id,
        label: cutText(title),
        detail: '',
        href: requestHref(row.id),
        kind: 'request',
        ...(row.sample ? { sample: true as const } : {}),
      },
    });
  });
  return { state: partial ? 'partial' : 'ok', candidates };
}

type Company = {
  name: string;
  country: string;
  lowest: string;
  reports: Set<string>;
  sample: boolean;
};

/** Reads one page of the portfolio into the companies met so far. Returns false when a context was malformed. */
function mergeCompanies(
  into: Map<string, Company>,
  companies: unknown[],
  sample: boolean,
): boolean {
  let clean = true;
  for (const entry of companies) {
    if (!record(entry) || !isCompanyId(entry.id) || !Array.isArray(entry.contexts)) {
      clean = false;
      continue;
    }
    for (const context of entry.contexts) {
      if (
        !record(context) ||
        !isUuid(context.resourceId) ||
        typeof context.company !== 'string' ||
        context.company === ''
      ) {
        clean = false;
        continue;
      }
      const resource = context.resourceId.toLowerCase();
      const country = typeof context.country === 'string' ? context.country : '';
      const company = into.get(entry.id);
      if (!company) {
        into.set(entry.id, {
          name: context.company,
          country,
          lowest: resource,
          reports: new Set([resource]),
          sample,
        });
        continue;
      }
      company.reports.add(resource);
      company.sample ||= sample;
      // The first approved context, by report id, names the company and is where the hit opens.
      if (resource < company.lowest) {
        company.lowest = resource;
        company.name = context.company;
        company.country = country;
      }
    }
  }
  return clean;
}

async function findCompanies(
  services: CustomerSearchServices,
  switches: CustomerSearchSwitches,
  context: CustomerSearchContext,
  guard: Guard,
  words: string[],
): Promise<Found> {
  const limits = customerSearchLimits;
  if (!switches.companies) return none('unavailable');
  const merged = new Map<string, Company>();
  let partial = false;
  let after: string | undefined;
  for (let page = 0; page < limits.companyPages; page++) {
    if (guard.expired()) {
      if (page === 0) return none('partial');
      partial = true;
      break;
    }
    let value: unknown;
    try {
      // The same budget the Companies page spends before every portfolio page, spent here before every page too.
      value = await guard.bounded(async () => {
        await services.companyBudget(context.client);
        return services.companies.list(
          after
            ? { pageSize: limits.companyPageSize, after }
            : { pageSize: limits.companyPageSize },
          context.subject,
          context.issuer,
        );
      });
    } catch (error) {
      if (error instanceof DeadlineReached) {
        if (page === 0) return none('partial');
        partial = true;
        break;
      }
      if (page > 0 && error instanceof DomainError && error.status === 429) {
        // The budget ran out part-way: what was found stays, and the scope says it was not read in full.
        partial = true;
        break;
      }
      if (page === 0) {
        const state = scopeFailure(error, 'companies');
        if (!state) throw failed(error, 'companies');
        return none(state);
      }
      if (endsSearch(error)) throw error;
      // A person whose access ended while the pages were read gets nothing from this scope.
      if (sqlState(error) === '42501') return none('denied');
      pageFailed(page + 1, context.correlationId, error);
      partial = true;
      break;
    }
    if (
      !record(value) ||
      !Array.isArray(value.companies) ||
      !switches.provenance(value.synthetic)
    ) {
      if (page === 0) return none('unavailable');
      partial = true;
      break;
    }
    if (!mergeCompanies(merged, value.companies, value.synthetic === true)) partial = true;
    if (typeof value.unavailableScopes === 'number' && value.unavailableScopes > 0) partial = true;
    const more = value.nextAfter;
    if (more === null || more === undefined) {
      after = undefined;
      break;
    }
    if (!isUuid(more)) {
      partial = true;
      break;
    }
    after = more;
  }
  // The pages ran out of budget while the portfolio had more.
  if (after !== undefined) partial = true;

  const candidates: Candidate[] = [];
  let position = 0;
  for (const [id, company] of merged) {
    position += 1;
    const ranked = rankFields(words, [
      { value: company.name, label: true },
      { value: company.country },
    ]);
    if (!ranked) continue;
    const facts: CustomerFacts = { reports: company.reports.size };
    if (ranked.close) facts.close = true;
    candidates.push({
      id,
      position,
      score: ranked.score,
      close: ranked.close,
      key: `company:${id}`,
      facts,
      hit: {
        id,
        label: cutText(company.name),
        detail: cutText(company.country),
        href: reportHref(company.lowest),
        kind: 'company',
        ...(company.sample ? { sample: true as const } : {}),
      },
    });
  }
  return { state: partial ? 'partial' : 'ok', candidates };
}

/** True when the words are worth reading for: two characters or more, with at least one letter or digit among them. */
export const worthSearching = (rawQuery: string) =>
  rawQuery.trim().length >= 2 && queryWords(rawQuery.trim()).length > 0;

/**
 * Searches the person's own Requests and approved Companies. A query that is too short, or has no letter or digit,
 * reads nothing. A refusal that ends the search (not signed in, closed account, a bad claim) is thrown as a DomainError;
 * any other first-read failure is thrown as it came, for the route to answer generically.
 */
export async function searchCustomer(
  services: CustomerSearchServices,
  switches: CustomerSearchSwitches,
  context: CustomerSearchContext,
  rawQuery: string,
  scope: CustomerSearchScope,
): Promise<CustomerSearchAnswer> {
  if (!worthSearching(rawQuery)) return { hits: [], scopes: {} };
  const words = queryWords(rawQuery.trim());
  const shown = scope === 'all' ? customerSearchLimits.showAll : customerSearchLimits.showScope;
  const answer: CustomerSearchAnswer = { hits: [], scopes: {} };
  const facts: Record<string, CustomerFacts> = {};
  const take = (name: CustomerScopeName, found: Found) => {
    answer.scopes[name] = found.state;
    for (const candidate of found.candidates.sort(inOrder).slice(0, shown)) {
      answer.hits.push(candidate.hit);
      facts[candidate.key] = candidate.facts;
    }
  };
  const guard = guardFor(context);
  if (scope === 'all' || scope === 'requests')
    take('requests', await findRequests(services, switches, context, guard, words));
  if (scope === 'all' || scope === 'companies') {
    try {
      take('companies', await findCompanies(services, switches, context, guard, words));
    } catch (error) {
      // Requests were already read: an unexpected Companies failure must not throw them away. A refusal still ends the search.
      if (scope === 'companies' || endsSearch(error)) throw error;
      scopeFailed('companies', context.correlationId, error);
      answer.scopes.companies = 'unavailable';
    }
  }
  return Object.keys(facts).length > 0 ? { ...answer, facts } : answer;
}
