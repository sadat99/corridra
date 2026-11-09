// The team command palette's search (Navigation v1, docs/revamp/specs/navigation-v1.md). It reads only
// through the services the workspace already uses (missions.queue and counterparties.catalogue), so the
// tenant, the role and row security that decide those reads decide this one: a person is shown only
// what they may open, and a read the role may not make is reported as denied, never as empty. It returns
// a label and one line of detail per hit and no other field. Owner: S4.
import { DomainError } from '@corridra/domain';
import type { RequestContext } from '@corridra/db';

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
};

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

const SHOWN = 5;
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

async function allowed<T>(denied: string[], scope: string, read: () => Promise<T>) {
  try {
    return await read();
  } catch (error) {
    if (error instanceof DomainError && error.status === 403) {
      denied.push(scope);
      return null;
    }
    throw error;
  }
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
  if (scope === 'all' || scope === 'missions') {
    const page = await allowed(result.denied, 'missions', () =>
      services.missions.queue(ctx, 'all', 0),
    );
    if (page) {
      result.missions = page.missions
        .filter((row) => {
          const brief = (row.brief ?? {}) as Record<string, unknown>;
          return matches(
            query,
            brief.company,
            brief.objective,
            brief.market,
            row.route_label,
            row.country_code,
          );
        })
        .slice(0, SHOWN)
        .map((row) => {
          const brief = (row.brief ?? {}) as Record<string, unknown>;
          return {
            id: String(row.id),
            label: text(brief.company) || 'Mission',
            detail: [text(brief.objective), text(brief.market)].filter(Boolean).join(' · '),
          };
        });
      if (page.total > page.missions.length) result.partial.push('missions');
    }
  }
  if (scope === 'all' || scope === 'companies') {
    // The catalogue matches whole words; a person types part of a name. Both reads are used: whole-word
    // matches first, then a part-of-name match over the first page of the list.
    const exact = await allowed(result.denied, 'companies', () =>
      services.counterparties.catalogue(ctx, { q: query }),
    );
    if (exact) {
      const first = await services.counterparties.catalogue(ctx, { q: '' });
      const seen = new Set<string>();
      const hits: PaletteHit[] = [];
      for (const row of [
        ...exact.organisations,
        ...first.organisations.filter((r) => matches(query, r.name, r.country)),
      ]) {
        const id = String(row.id);
        if (seen.has(id)) continue;
        seen.add(id);
        hits.push({ id, label: text(row.name), detail: text(row.country) });
      }
      result.companies = hits.slice(0, SHOWN);
      if (first.total > first.organisations.length) result.partial.push('companies');
    }
  }
  return result;
}
