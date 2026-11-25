import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// UI/UX.v4.1 audit of the public and helper pages (rows public-customer-13, -14, -18 and -20): one link per
// destination and one primary inside main, no Back-to links, and a real way on from a page with nothing to show.
const read = (file: string) => readFileSync(resolve(file), 'utf8');

describe('/contributor/me without a workspace link', () => {
  const page = read('apps/web/app/contributor/me/page.tsx');
  const start = page.indexOf('if (!s || !workspace.success)');
  const branch = page.slice(start, page.indexOf('await s.ready;', start));
  it('has no Back-to link and gives a signed-in helper Sign Out, anyone else the helper sign-in', () => {
    expect(page).not.toMatch(/Back to/);
    expect(branch).toContain('<ContributorSignout />');
    expect(branch).toContain('href="/contributor/signin"');
    expect(branch).toContain('Helper Sign-In');
    // The page still says a customer account does not grant task access (L9).
    expect(branch.replace(/\s+/g, ' ')).toContain(
      'A customer account does not grant assigned-task access.',
    );
  });
  it('reads nothing but the session the page already checks', () => {
    expect(page.match(/provider\.getSession\(/g)).toHaveLength(2);
    expect(page).not.toMatch(/fetch\(|\.query\(/);
  });
});

describe('the helper pages write no Back-to link', () => {
  it('names the destination on the signed-out helper page', () => {
    const page = read('apps/web/app/contributor/page.tsx');
    expect(page).not.toMatch(/Back to/);
    expect(page.replace(/\s+/g, ' ')).toContain('href="/"> Corridra Home </Link>');
  });
});

describe('/corridors: the Another Route block', () => {
  const page = read('apps/web/app/corridors/page.tsx');
  it('links the request form once and holds no primary of its own', () => {
    expect(page.match(/href="\/plan"/g)).toHaveLength(1);
    expect(page).not.toContain('className="primary-link"');
    expect(page).toContain('Plan a Mission on Another Route');
    expect(page).toContain('href="#mission-example"');
  });
});

describe('the helper task words', () => {
  const board = read('apps/web/app/contributor/task-board.tsx');
  it('never prints the reviewer id and keeps the form field names', () => {
    expect(board).not.toContain('{task.reviewer}');
    expect(board).toContain('<dd>Corridra reviewer</dd>');
    expect(board.match(/name="reason"/g)).toHaveLength(3);
    expect(board.match(/name="body"/g)).toHaveLength(1);
    for (const old of [
      'EXACT ASSIGNMENT',
      'Accept the Disclosed Task',
      'Acceptance and relationship confirmation',
    ])
      expect(board).not.toContain(old);
  });
});
