import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Every customer API answers with private data, so each one must be registered in the framework's header
// overrides in apps/web/next.config.ts: a header set only inside a handler can be replaced by the framework's
// own defaults (root AGENTS.md: register each new private API there before checking the compiled route). This
// reads that file and the route folders, so a new customer-* route that is not registered fails here.
const config = readFileSync(resolve('apps/web/next.config.ts'), 'utf8');
const rules = [...config.matchAll(/source:\s*'([^']+)',\s*headers:\s*\[([^\]]*)\]/g)].map(
  (match) => ({ source: match[1]!, headers: match[2]! }),
);
const covers = (source: string, route: string) => {
  const prefix = `/api/${route}`;
  if (source === prefix || source.startsWith(prefix + '/')) return true;
  const list = /^\/api\/:page\(([^)]+)\)$/.exec(source)?.[1];
  return !!list && list.split('|').includes(route);
};
const routes = readdirSync(resolve('apps/web/app/api'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('customer-'))
  .map((entry) => entry.name)
  .sort();
// Intentionally unregistered customer-* routes, each with its reason. Nothing is exempt silently.
const publicByDesign: Record<string, string> = {};

describe('private customer APIs and the framework header overrides', () => {
  it('finds the customer routes and the override rules it checks', () => {
    expect(routes.length).toBeGreaterThan(20);
    expect(routes).toContain('customer-saved-missions');
    expect(rules.length).toBeGreaterThan(10);
  });
  for (const route of routes)
    it(`${route} is registered with no-referrer and no-store`, () => {
      if (route in publicByDesign) return;
      const matching = rules.filter((rule) => covers(rule.source, route));
      expect(
        matching,
        `${route} is missing from the private-header overrides in next.config.ts`,
      ).not.toHaveLength(0);
      for (const rule of matching) {
        expect(rule.headers).toContain("key: 'Referrer-Policy', value: 'no-referrer'");
        expect(rule.headers).toContain("key: 'Cache-Control', value: 'no-store'");
      }
    });
  it('keeps every exemption reasoned and real', () => {
    for (const [route, reason] of Object.entries(publicByDesign)) {
      expect(routes).toContain(route);
      expect(reason.length).toBeGreaterThan(20);
    }
  });
});

// The public decision card read (ADR-076 item 4) is anonymous, so it is not under customer-*; it still answers
// with a card, so the framework must never replace its no-store, no-referrer or noindex headers.
describe('the public decision card API and the framework header overrides', () => {
  const matching = rules.filter((rule) => rule.source === '/api/decision-card');
  it('has one explicit rule for /api/decision-card', () => {
    expect(
      matching,
      'the public card read is missing from the private-header overrides',
    ).toHaveLength(1);
  });
  it('sends no-referrer, no-store and noindex, nofollow', () => {
    const headers = matching[0]!.headers;
    expect(headers).toContain("key: 'Referrer-Policy', value: 'no-referrer'");
    expect(headers).toContain("key: 'Cache-Control', value: 'no-store'");
    expect(headers).toContain("key: 'X-Robots-Tag', value: 'noindex, nofollow'");
  });
  it('registers the owner API among the customer pages as well', () => {
    expect(
      rules.some((rule) => covers(rule.source, 'customer-decision-cards')),
      'customer-decision-cards is missing from the private-header overrides',
    ).toBe(true);
  });
});

// The team command palette's search (Navigation v1, Sensitive: yes) answers with mission and company names, so the
// framework must never replace its no-store or no-referrer headers. Registered here, checked here, and the compiled
// response is checked in tests/e2e/verification/ws-e/team-shell.spec.ts.
describe('the team palette search API and the framework header overrides', () => {
  const matching = rules.filter((rule) => rule.source === '/api/workspace/search');
  it('has one explicit rule for /api/workspace/search with no-referrer and no-store', () => {
    expect(
      matching,
      'the palette search is missing from the private-header overrides in next.config.ts',
    ).toHaveLength(1);
    expect(matching[0]!.headers).toContain("key: 'Referrer-Policy', value: 'no-referrer'");
    expect(matching[0]!.headers).toContain("key: 'Cache-Control', value: 'no-store'");
  });
});

// The team problem report API (ADR-078) answers with a person's own words and the staff triage queue, so the framework
// must never replace its no-store or no-referrer headers. It is under /api/workspace, not customer-*, so it is named here;
// the customer problem report API is covered by the customer-* list above.
describe('the team problem report API and the framework header overrides', () => {
  const matching = rules.filter((rule) => rule.source === '/api/workspace/problem-reports');
  it('has one explicit rule for /api/workspace/problem-reports with no-referrer and no-store', () => {
    expect(
      matching,
      'the team problem report API is missing from the private-header overrides in next.config.ts',
    ).toHaveLength(1);
    expect(matching[0]!.headers).toContain("key: 'Referrer-Policy', value: 'no-referrer'");
    expect(matching[0]!.headers).toContain("key: 'Cache-Control', value: 'no-store'");
  });
  it('registers the customer problem report API among the customer pages', () => {
    expect(
      rules.some((rule) => covers(rule.source, 'customer-problem-reports')),
      'customer-problem-reports is missing from the private-header overrides',
    ).toBe(true);
  });
});

// The staff supply API (ADR-082 slice S3) answers with source, candidate and do not contact records, so the framework must
// never replace its no-store or no-referrer headers. It is not under customer-*, so it is named here. The rule is a path
// pattern (every action under /api/supply), because the action is the last segment of the address.
describe('the staff supply API and the framework header overrides', () => {
  const matching = rules.filter((rule) => rule.source === '/api/supply/:path*');
  it('has one explicit rule for every address under /api/supply with no-referrer and no-store', () => {
    expect(
      matching,
      'the staff supply API is missing from the private-header overrides in next.config.ts',
    ).toHaveLength(1);
    expect(matching[0]!.headers).toContain("key: 'Referrer-Policy', value: 'no-referrer'");
    expect(matching[0]!.headers).toContain("key: 'Cache-Control', value: 'no-store'");
  });
});
