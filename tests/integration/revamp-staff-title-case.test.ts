import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { titleCaseFindings } from './title-case-scan';

// Owner rule, 5 Nov 2026 (ui-direction): button and action labels use Title Case in English. This is the staff,
// contributor and owner side of the customer test in revamp-title-case.test.ts: it reads every button,
// button-styled link and menu item in the pages and components the staff track owns, from the source, with the
// same scanner. The text itself is written in Title Case; no stylesheet changes the case.
const roots = [
  'apps/web/app/operator',
  'apps/web/app/contributor',
  'apps/web/app/network',
  'apps/web/app/mute',
  'apps/web/app/pulse',
  'apps/web/components/operator-workbench.tsx',
  'apps/web/components/ux/left-nav.tsx',
  'apps/web/components/ux/sub-tabs.tsx',
  'apps/web/components/ux/contributor-frame.tsx',
  'apps/web/components/ux/team-frame.tsx',
  'apps/web/components/ux/show-more.tsx',
  'apps/web/components/ux/operator-icon.tsx',
];

function staffFiles(root = process.cwd()): string[] {
  const out: string[] = [];
  const walk = (path: string) => {
    let info;
    try {
      info = statSync(path);
    } catch {
      return;
    }
    if (info.isDirectory()) for (const name of readdirSync(path)) walk(join(path, name));
    else if (/\.tsx$/.test(path)) out.push(path);
  };
  for (const entry of roots) walk(join(root, entry));
  return out.sort();
}

describe('Title Case for staff, contributor and owner button labels', () => {
  it('reads the staff files, so the check below is not empty', () => {
    expect(staffFiles().length).toBeGreaterThan(50);
  });

  it('is applied to every staff button, button-styled link and menu item', () => {
    const wrong = staffFiles().flatMap((file) =>
      titleCaseFindings(file).map(
        (item) => `${file.replace(process.cwd() + '/', '')}: "${item.text}"`,
      ),
    );
    expect(wrong).toEqual([]);
  });
});
