// The team command palette's search (Navigation v1, docs/revamp/specs/navigation-v1/command-palette-search.md).
// It reads only through the services the workspace already uses (missions.queue and counterparties.catalogue), so
// the tenant, the role and row security that decide those reads decide this one: a person is shown only what they
// may open, and a read the role may not make is reported as denied, never as empty. It reads a bounded number of
// pages (paletteLimits), ranks what it read (palette-rank.ts) and returns a label and one line of detail per hit
// and no other field. The stage of a mission and the source flag of a company travel in a separate `facts` map,
// present only when there are hits. It writes nothing and never logs the query. Owner: S4.
import { DomainError } from '@corridra/domain';
import type { RequestContext } from '@corridra/db';
import { queryWords, rankFields } from './palette-rank';
import type { PaletteFacts } from './ux/palette-facts';

export type { PaletteFacts } from './ux/palette-facts';
export const paletteScopes = ['all', 'missions', 'companies'] as const;
export type PaletteScope = (typeof paletteScopes)[number];
export type PaletteHit = { id: string; label: string; detail: string };
export type PaletteResult = {
  missions: PaletteHit[];
  companies: PaletteHit[];
  /** Scopes the person's role may not read in this workspace. */
  denied: string[];
  /** Scopes where more rows exist than were searched, so a match may be missing. */
  partial: string[];
  /** Beside the hits, keyed `mission:<id>` or `company:<id>`; present only when there are hits with a fact to show. */
  facts?: Record<string, PaletteFacts>;
};

/**
 * Work per request. Missions: up to 3 queue pages of 100 (300 missions). Companies: the whole-word read, then up to 4
 * scan pages of 50 (200 companies). Scopes run one after the other, so one search holds one database connection at a
 * time. showAll hits per scope under All, showScope for a single scope. Pages are read until the scope is read
 * completely, a page is empty or the cap is reached; there is no early stop, so a better match on a later page is
 * never skipped.
 */
export const paletteLimits = {
  queuePages: 3,
  cataloguePages: 4,
  showAll: 5,
  showScope: 10,
} as const;

type Services = {
  missions: {
    queue(
      ctx: RequestContext,
      filter: 'all',
      offset: number,
    ): Promise<{ missions: Record<string, unknown>[]; total: number }>;
  };
  counterparties: {
    catalogue(
      ctx: RequestContext,
      input: unknown,
    ): Promise<{ organisations: Record<string, unknown>[]; total: number }>;
  };
};

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** Every word of the query must appear, in any order, case aside. */
export function matches(query: string, ...fields: unknown[]): boolean {
  const haystack = fields.map(text).join(' ').toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

const isForbidden = (error: unknown) => error instanceof DomainError && error.status === 403;

type Candidate = {
  id: string;
  position: number;
  score: number;
  close: boolean;
  hit: PaletteHit;
  status?: string;
};
type Found = {
  candidates: Candidate[];
  denied: boolean;
  partial: boolean;
  sources?: Map<string, string>;
};

/** Best score first, then the order the service gave the rows, then the id by plain code unit. */
function inOrder(a: Candidate, b: Candidate) {
  return b.score - a.score || a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function pageFailed(scope: string, page: number, ctx: RequestContext, error: unknown) {
  // The scope, the page, the request id and the kind of error and its code: never the words that were typed and
  // never the error message, which a database may fill with them.
  const name = error instanceof Error && error.name.length <= 64 ? error.name : undefined;
  const raw = (error as { code?: unknown } | null)?.code;
  const code =
    (typeof raw === 'string' || typeof raw === 'number') && String(raw).length <= 32
      ? raw
      : undefined;
  console.error(
    JSON.stringify({
      event: 'palette_search_page_failed',
      scope,
      page,
      correlationId: ctx.correlationId,
      errorName: name,
      errorCode: code,
    }),
  );
}

async function findMissions(
  services: Services,
  ctx: RequestContext,
  words: string[],
): Promise<Found> {
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  let read = 0;
  let position = 0;
  let total = 0;
  for (let page = 0; page < paletteLimits.queuePages; page++) {
    let rows: { missions: Record<string, unknown>[]; total: number };
    try {
      rows = await services.missions.queue(ctx, 'all', read);
    } catch (error) {
      // A role refused on any page gets nothing from this scope; another failure after the first page keeps what was found.
      if (isForbidden(error)) return { candidates: [], denied: true, partial: false };
      if (page === 0) throw error;
      pageFailed('missions', page, ctx, error);
      return { candidates, denied: false, partial: true };
    }
    for (const row of rows.missions) {
      position += 1;
      const id = String(row.id);
      if (seen.has(id)) continue;
      seen.add(id);
      const brief = (row.brief ?? {}) as Record<string, unknown>;
      const ranked = rankFields(words, [
        { value: brief.company, label: true },
        { value: brief.objective },
        { value: brief.market },
        { value: row.route_label },
        { value: row.country_code },
      ]);
      if (!ranked) continue;
      candidates.push({
        id,
        position,
        score: ranked.score,
        close: ranked.close,
        status: typeof row.status === 'string' ? row.status : undefined,
        hit: {
          id,
          label: text(brief.company) || 'Mission',
          detail: [text(brief.objective), text(brief.market)].filter(Boolean).join(' · '),
        },
      });
    }
    read += rows.missions.length;
    total = rows.total;
    if (rows.missions.length === 0 || total <= read) break;
  }
  return { candidates, denied: false, partial: total > read };
}

const sourceRank: Record<string, number> = { SOURCE_REPORTED: 2, EXPIRED: 1 };

async function findCompanies(
  services: Services,
  ctx: RequestContext,
  query: string,
  words: string[],
): Promise<Found> {
  // The catalogue matches whole words; a person types part of a name. Both reads are used: the whole-word read
  // first, then a part-of-name match over the first pages of the list.
  let exact: { organisations: Record<string, unknown>[]; total: number };
  try {
    exact = await services.counterparties.catalogue(ctx, { q: query });
  } catch (error) {
    if (isForbidden(error)) return { candidates: [], denied: true, partial: false };
    throw error;
  }
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  // An organisation may appear once for each public identifier; the best source flag of its rows is kept.
  const sources = new Map<string, string>();
  let position = 0;
  const take = (row: Record<string, unknown>, keepUnmatched: boolean) => {
    position += 1;
    const id = String(row.id);
    const flag = text(row.identity_status);
    if ((sourceRank[flag] ?? 0) > (sourceRank[sources.get(id) ?? ''] ?? 0)) sources.set(id, flag);
    if (seen.has(id)) return;
    const ranked = rankFields(words, [{ value: row.name, label: true }, { value: row.country }]);
    // A row the catalogue itself matched (a domain or an identifier) is kept, as before.
    if (!ranked && !keepUnmatched) return;
    seen.add(id);
    candidates.push({
      id,
      position,
      score: ranked?.score ?? 1,
      close: ranked?.close ?? false,
      hit: { id, label: text(row.name), detail: text(row.country) },
    });
  };
  for (const row of exact.organisations) take(row, true);
  const exactIncomplete = exact.total > exact.organisations.length;
  let read = 0;
  let total = 0;
  for (let page = 0; page < paletteLimits.cataloguePages; page++) {
    let rows: { organisations: Record<string, unknown>[]; total: number };
    try {
      rows = await services.counterparties.catalogue(ctx, { q: '', offset: read });
    } catch (error) {
      if (isForbidden(error)) return { candidates: [], denied: true, partial: false };
      pageFailed('companies', page + 1, ctx, error);
      return { candidates, denied: false, partial: true, sources };
    }
    for (const row of rows.organisations) take(row, false);
    read += rows.organisations.length;
    total = rows.total;
    if (rows.organisations.length === 0 || total <= read) break;
  }
  // Partial when rows remain unread at the cap, or when the whole-word read had more rows than one page.
  return {
    candidates,
    denied: false,
    partial: exactIncomplete || total > read,
    sources,
  };
}

export async function searchPalette(
  services: Services,
  ctx: RequestContext,
  rawQuery: string,
  scope: PaletteScope,
): Promise<PaletteResult> {
  const query = rawQuery.trim().slice(0, 80);
  const result: PaletteResult = { missions: [], companies: [], denied: [], partial: [] };
  if (query.length < 2) return result;
  // A query with no letter or digit has nothing to look for: nothing is read.
  const words = queryWords(query);
  if (words.length === 0) return result;
  const shown = scope === 'all' ? paletteLimits.showAll : paletteLimits.showScope;
  const facts: Record<string, PaletteFacts> = {};
  if (scope === 'all' || scope === 'missions') {
    const found = await findMissions(services, ctx, words);
    if (found.denied) result.denied.push('missions');
    else {
      for (const candidate of found.candidates.sort(inOrder).slice(0, shown)) {
        result.missions.push({
          id: candidate.hit.id,
          label: candidate.hit.label,
          detail: candidate.hit.detail,
        });
        const fact: PaletteFacts = {};
        if (candidate.status && /^[A-Z][A-Z_]{0,31}$/.test(candidate.status))
          fact.status = candidate.status;
        if (candidate.close) fact.close = true;
        if (fact.status || fact.close) facts['mission:' + candidate.id] = fact;
      }
      if (found.partial) result.partial.push('missions');
    }
  }
  if (scope === 'all' || scope === 'companies') {
    const found = await findCompanies(services, ctx, query, words);
    if (found.denied) result.denied.push('companies');
    else {
      for (const candidate of found.candidates.sort(inOrder).slice(0, shown)) {
        result.companies.push({
          id: candidate.hit.id,
          label: candidate.hit.label,
          detail: candidate.hit.detail,
        });
        const fact: PaletteFacts = {};
        const flag = found.sources?.get(candidate.id);
        if (flag === 'SOURCE_REPORTED' || flag === 'EXPIRED') fact.source = flag;
        if (candidate.close) fact.close = true;
        if (fact.source || fact.close) facts['company:' + candidate.id] = fact;
      }
      if (found.partial) result.partial.push('companies');
    }
  }
  return Object.keys(facts).length > 0 ? { ...result, facts } : result;
}
