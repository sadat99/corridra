import { describe, expect, test } from 'vitest';
import { sheetLimits, sheetWords } from '../../packages/missions/src/route-pack-sheet';
import {
  exportWords,
  historyWords,
  importWords,
} from '../../apps/web/app/operator/route-pack-data-words';

// ADR-093 PR 4: the count builders say exactly what spec 12.1, 12.2 and 16 say.
describe('Import Route Data words', () => {
  test('step lines and problem headings', () => {
    expect(importWords.stepLine(2, importWords.stepNames[1] ?? '')).toBe('Step 2 of 4: Check');
    expect(importWords.problemsHeading(7, 4)).toBe(
      '7 problems in 4 rows. Nothing is saved while any problem remains.',
    );
    expect(importWords.problemsHeading(1, 1)).toBe(
      '1 problem in 1 row. Nothing is saved while any problem remains.',
    );
    expect(importWords.problemsHeading(3, 0)).toBe(
      '3 problems. Nothing is saved while any problem remains.',
    );
    expect(importWords.showAllProblems(7)).toBe('Show all 7 problems');
  });
  test('problem items leave out what is absent', () => {
    expect(
      importWords.problemItem(
        14,
        'BD-CN',
        'Working languages',
        'use language tags such as en or bn.',
      ),
    ).toBe('Row 14, BD-CN, Working languages: use language tags such as en or bn.');
    expect(importWords.problemItem(null, null, null, 'The file is empty.')).toBe(
      'The file is empty.',
    );
    expect(importWords.problemItem(null, 'BD-CN', 'Currencies used', 'one problem.')).toBe(
      'BD-CN, Currencies used: one problem.',
    );
  });
  test('review and outcome lines', () => {
    expect(importWords.ready(3)).toBe('Ready to save 3 routes.');
    expect(importWords.skippedPending(2)).toBe(
      '2 rows skipped: new custom fields that are still Pending.',
    );
    expect(importWords.skippedMixed(5)).toBe('5 rows skipped.');
    expect(importWords.saving(3)).toBe('Saving 3 routes…');
    expect(importWords.checking).toBe('Checking the file…');
    expect(importWords.saved(3, 15)).toBe('Saved 3 routes, 15 facts.');
    expect(importWords.saved(3, 1)).toBe('Saved 3 routes, 1 fact.');
    expect(importWords.saved(3, 0)).toBe('Saved 3 routes. No fact changed.');
    expect(importWords.partWay(1, 3, ['China to Bangladesh', 'EU to Bangladesh'])).toBe(
      'Saved 1 of 3 routes. Not saved: China to Bangladesh, EU to Bangladesh.',
    );
    expect(importWords.notTried('EU to China')).toBe(
      'EU to China: Not tried, because the save stopped before it.',
    );
    expect(importWords.routeChanged('Bangladesh to EU')).toBe(
      'Bangladesh to EU changed while you were checking. It was not saved. Choose the file again to check it against the current state.',
    );
    expect(importWords.openRoute('Bangladesh to China')).toBe('Open Bangladesh to China');
  });
  test('fixed words agree with the server', () => {
    expect(importWords.intro).toContain(`${sheetLimits.octets / 1048576} MB`);
    expect(importWords.intro).toContain(`${sheetLimits.rows} rows`);
    expect(importWords.intro).toContain(`${sheetLimits.routes} routes`);
    expect(exportWords.tooMany).toBe(sheetWords.exportRoutes);
  });
});

describe('Export and History words', () => {
  test('download line', () => {
    expect(exportWords.downloaded('route-packs-2026-11-26.csv', 2)).toBe(
      'Downloaded route-packs-2026-11-26.csv with 2 routes.',
    );
    expect(exportWords.downloaded('route-packs-2026-11-26.csv', 1)).toBe(
      'Downloaded route-packs-2026-11-26.csv with 1 route.',
    );
  });
  test('history rows', () => {
    expect(historyWords.factRow(5, '26 Nov 2026', historyWords.by.you)).toBe(
      'Version 5, 26 Nov 2026, by you',
    );
    expect(historyWords.packRow(3, '26 Nov 2026', historyWords.by.split)).toBe(
      'Pack version 3, effective 26 Nov 2026, by one team member, published by another',
    );
    expect(historyWords.noReason).toBe('No reason recorded.');
  });
});
