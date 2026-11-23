import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Unit B3b of the commercial-ready run (owner decisions, 23 Nov 2026): the account workspaces, team, lifecycle,
// closure, personal profile, saved request and private request screens. Read from the source without a browser or a
// database; the live behaviour in a browser is tests/operator/revamp-cx2b-workspaces.spec.ts and
// tests/operator/v3-guided-request-ui.spec.ts.
const root = createRequire(resolve('package.json'));
const ts = root('typescript') as typeof import('typescript');
const source = (path: string) => readFileSync(resolve('apps/web', path), 'utf8');

/** Every piece of text a file can put on screen: string and template literals and JSX text, never an import path. */
function words(path: string): string[] {
  const file = ts.createSourceFile(
    path,
    source(path),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const out: string[] = [];
  const visit = (node: import('typescript').Node) => {
    if (ts.isImportDeclaration(node)) return;
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    )
      out.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

// Names a person never reads: routes, the API path, a storage key suffix, a URL parameter and a class name. Owner,
// 23 Nov 2026: code names, routes like /account/drafts, keys and storage keys stay.
const codeNames = [
  '/account/drafts/',
  '/api/customer-mission-drafts',
  'ux-draft-notice',
  ':draft',
  'draftId',
] as const;
const readable = (path: string) =>
  words(path)
    .filter((word) => word !== 'draft')
    .map((word) => codeNames.reduce((left, name) => left.split(name).join(''), word));

const workspaceFiles = [
  'app/account/customer-workspaces.tsx',
  'app/account/customer-workspace-team.tsx',
  'app/account/customer-workspace-invitation.tsx',
  'app/account/customer-workspace-leave.tsx',
  'app/account/workspace-lifecycle.tsx',
  'app/account/workspace-lifecycle-dialogs.tsx',
  'app/account/workspace-lifecycle-client.ts',
  'app/account/account-closure.tsx',
  'app/account/personal-profile.tsx',
  'app/account/drafts/guided-request.tsx',
  'app/account/drafts/[workspaceId]/page.tsx',
  'app/account/request/private-request-intake.tsx',
  'app/account/request/[workspaceId]/page.tsx',
  'lib/private-request-storage.ts',
];

describe('D-052: no customer-readable "draft" in the workspace, saved request and private request screens', () => {
  it.each(workspaceFiles)('%s', (path) => {
    expect(readable(path).filter((word) => /draft/i.test(word))).toEqual([]);
  });

  it('the row menu says Continue a Saved Request and keeps its route', () => {
    const code = source('app/account/customer-workspaces.tsx');
    expect(code).toContain('Continue a Saved Request');
    expect(code).toContain("href={'/account/drafts/' + row.id}");
  });

  it('the saved request screen keeps its routes, API path, URL parameter and storage keys', () => {
    const guided = source('app/account/drafts/guided-request.tsx');
    expect(guided).toContain("'/api/customer-mission-drafts'");
    expect(guided).toContain(".get('draft')");
    expect(source('lib/private-request-storage.ts')).toContain("draft: key + ':draft'");
  });
});

describe('plain words in account closure, personal profile and the private request keys', () => {
  it.each([
    'app/account/account-closure.tsx',
    'app/account/personal-profile.tsx',
    'lib/private-request-storage.ts',
  ])('%s has no brief, synthetic, operator, contributor or scope a person can read', (path) => {
    expect(
      readable(path).filter((word) =>
        /\b(brief|synthetic|operator|contributor|scoped?)\b/i.test(word),
      ),
    ).toEqual([]);
  });
});

describe('D-050: a customer time is written the one way, in the time zone of the reader', () => {
  const customerFiles = [
    'app/account/customer-workspace-team.tsx',
    'app/account/workspace-lifecycle.tsx',
    'app/account/workspace-lifecycle-dialogs.tsx',
    'app/account/account-closure.tsx',
  ];
  it.each(customerFiles)('%s uses formatDateTime and never a UTC formatter', (path) => {
    const code = source(path);
    expect(code).toMatch(/formatDateTime\(/);
    expect(code).not.toContain('whenWords');
    expect(code).not.toMatch(/timeZone:\s*'UTC'/);
    expect(code).not.toContain("+ ' UTC'");
  });

  it('the UTC helper is kept, unchanged, for the staff screens that still import it', async () => {
    const client = source('app/account/workspace-lifecycle-client.ts');
    expect(client).toContain('Staff screens only');
    const { whenWords } = (await import(
      /* @vite-ignore */ '../../apps/web/app/account/workspace-lifecycle-client'
    )) as { whenWords: (value: string) => string };
    expect(whenWords('2026-11-06T14:30:00Z')).toBe('6 Nov 2026, 14:30 UTC');
  });

  it('writes the owner example the one way', async () => {
    const { formatDateTime } = (await import(
      /* @vite-ignore */ '../../apps/web/lib/ux/format'
    )) as {
      formatDateTime: (value: string, opts?: { timeZone?: string }) => string;
    };
    expect(formatDateTime('2026-11-24T07:07:00Z', { timeZone: 'Asia/Dhaka' })).toBe(
      '24 Nov 2026, 13:07 (Dhaka, UTC+6)',
    );
  });
});

describe('D-044: a workspace invitation code is copied with the shared Copy button', () => {
  it('the new invitation code sits in a copy row with CopyButton', () => {
    const code = source('app/account/customer-workspace-team.tsx');
    expect(code).toContain("from '../../components/ux/copy-button'");
    expect(code).toMatch(
      /<div className="ux-copy-row">[\s\S]*?<CopyButton value=\{issued\.token\}/,
    );
  });
});

describe('D-051: the row menu is not cut off by the workspaces table card', () => {
  const css = source('app/account/workspace-table.css');
  it('the table does not clip what is drawn over it', () => {
    expect(css).not.toMatch(/\.ux-ws-table \{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.ux-ws-table \{[^}]*overflow:\s*visible/);
  });
  it('the corner cells carry the card radius so the head row and the hover colour stay inside the border', () => {
    expect(css).toMatch(/border-start-start-radius/);
    expect(css).toMatch(/border-start-end-radius/);
    expect(css).toMatch(/border-end-start-radius/);
    expect(css).toMatch(/border-end-end-radius/);
  });
});
