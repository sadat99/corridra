import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

// Source-level guards for the customer search server code (Sensitive: yes; docs/revamp/specs/navigation-v1/
// customer-search.md, sections 2, 5 and 6): the route and its core reach customer data only through the customer
// services, import no staff service and no catalogue, hold no SQL, and never put the typed words in a log. The
// stylesheet and component checks belong to the UI stage.
const files = {
  route: 'apps/web/app/api/customer-search/route.ts',
  core: 'apps/web/lib/customer-search.ts',
};
const text = Object.fromEntries(
  Object.entries(files).map(([name, path]) => [name, readFileSync(path, 'utf8')]),
);
const both = Object.values(files);
const imports = (source: string) =>
  [...source.matchAll(/(?:from|import)\s+'([^']+)'/g)].map((match) => match[1]!);

describe('D4 no staff service, no catalogue, no company linking', () => {
  test('the route and the core import nothing staff-side', () => {
    for (const path of both) {
      for (const specifier of imports(readFileSync(path, 'utf8')))
        expect(specifier, path).not.toMatch(
          /missions|counterparties|workspace\/search|team-|palette-search|palette-recents|catalogue|organisation-link/i,
        );
    }
  });
  test('only the customer services of the foundations are used', () => {
    expect(text.route).toContain('s.customerRequests');
    expect(text.route).toContain('s.customerRequestDetails');
    expect(text.route).toContain('s.customerCompanies');
    // The one use of the missions service is the public intake budget the Companies route also spends; never its staff queue.
    expect(text.route.match(/\.missions\b/g)).toHaveLength(1);
    expect(text.route).toContain('s.missions.budget(client)');
    for (const source of Object.values(text)) {
      expect(source.replace('s.missions.budget(client)', '')).not.toMatch(
        /\.missions\b|\.counterparties\b|\.provider\b|\.catalogue\b|catalogue/,
      );
      expect(source).not.toMatch(/organisation_link_search|customerOrganisationLinks/);
    }
  });
  test('the staff palette route and rank module are not edited by importing them wrongly: only palette-rank is imported', () => {
    expect(imports(text.core).filter((specifier) => /palette/.test(specifier))).toEqual([
      './palette-rank',
    ]);
  });
});

describe('no SQL, no connection, no data class of its own', () => {
  test('the route and the core hold no database access', () => {
    for (const path of both)
      expect(readFileSync(path, 'utf8'), path).not.toMatch(
        /@corridra\/db|\.query\(|\.connect\(|from 'pg'|new Pool|customer\.[a-z_]+\(|customer_private\./,
      );
  });
  test('the search is a plain POST: no GET handler and no query string is read', () => {
    expect(text.route).toMatch(/export async function POST\(/);
    expect(text.route).not.toMatch(/export (?:async )?function (?:GET|PUT|PATCH|DELETE)\b/);
    for (const source of Object.values(text))
      expect(source).not.toMatch(/searchParams|URLSearchParams|new URL\(|request\.url|nextUrl/);
  });
});

describe('D9 the typed words are never logged', () => {
  const logCalls = (source: string) =>
    [...source.matchAll(/(?:console\.\w+|logger\.\w+|log)\(([\s\S]*?)\);/g)].map(
      (match) => match[1]!,
    );
  test('every log call has a fixed shape and mentions neither the query nor the body', () => {
    let seen = 0;
    for (const path of both) {
      for (const call of logCalls(readFileSync(path, 'utf8'))) {
        seen += 1;
        expect(call, path).not.toMatch(
          /\bq\b|query|input|body|text|words|error\.message|\.message/i,
        );
      }
    }
    expect(seen).toBe(4);
  });
  test('the log events are the two named ones', () => {
    const events = both.flatMap((path) =>
      [...readFileSync(path, 'utf8').matchAll(/event: '([a-z_]+)'/g)].map((match) => match[1]),
    );
    expect(events.sort()).toEqual([
      'customer_search_failed',
      'customer_search_page_failed',
      'customer_search_scope_failed',
      'customer_search_slot_forced',
    ]);
  });
  test('the query leaves the core only as a score, never as an argument to a service', () => {
    // The services are called with page sizes and cursors, and the title lookup with a Request id.
    const calls = [...text.core.matchAll(/services\.\w+\.\w+\(([\s\S]*?)\)/g)].map((m) => m[1]!);
    expect(calls).toHaveLength(3);
    for (const call of calls) expect(call).not.toMatch(/rawQuery|\btext\b|words/);
  });
});

describe('the limits live in one place and the words are English without a dash', () => {
  test('every number of the work caps is in customerSearchLimits and used by name', () => {
    const code = text.core
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/customerSearchLimits = \{[\s\S]*?\} as const;/, '');
    for (const key of [
      'requestPage',
      'titleCap',
      'titleConcurrency',
      'titleBudgetMs',
      'titleFailureStop',
      'companyPages',
      'companyPageSize',
      'showAll',
      'showScope',
    ])
      expect(code, key).toMatch(
        new RegExp(`limits\\.${key}\\b|customerSearchLimits\\.${key}\\b`, 'i'),
      );
    expect(code).not.toMatch(/\b(?:30|100|6000)\b/);
  });
  test('no em dash and straight quotes only in code', () => {
    for (const path of both) {
      const source = readFileSync(path, 'utf8');
      expect(source).not.toMatch(/—/);
      expect(source).not.toMatch(/[‘’“”]/);
    }
  });
  test('the word Mission is not on a screen: no user-facing string says it', () => {
    for (const path of both)
      expect(readFileSync(path, 'utf8').match(/'[^'\n]*\bMission\b[^'\n]*'/g) ?? []).toEqual([]);
  });
});
