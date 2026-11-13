import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyServiceContext } from '../../apps/web/lib/work-items/classify';
import { CompanyLinkLine } from '../../apps/web/app/account/company-link-status';

// L12 (signed-in sweep, owner screenshots of 13 November 2026). Each case fails on the code before the fix.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (type: unknown, props?: unknown) => unknown;
const render = web('react-dom/server').renderToStaticMarkup as (element: unknown) => string;

describe('L12 Your work classification', () => {
  it('a paid service about a programme is Organise work; other contexts stay unclassified', () => {
    expect(classifyServiceContext('programme')).toBe('ORGANISE');
    expect(classifyServiceContext('request')).toBe('UNCLASSIFIED');
    expect(classifyServiceContext('company')).toBe('UNCLASSIFIED');
    expect(classifyServiceContext(undefined)).toBe('UNCLASSIFIED');
  });
});

describe('L12 company link cell', () => {
  it('puts the repeated column name in a label that desktop hides, and keeps the words', () => {
    const html = render(
      createElement(CompanyLinkLine, {
        overview: { w1: { status: 'none', organisationName: null } },
        workspaceId: 'w1',
      }),
    );
    expect(html).toContain('<span class="ux-ws-cell-label">Company link: </span>');
    expect(html).toContain('No company link yet');
  });
});
