import { beforeEach, describe, expect, test } from 'vitest';
import {
  problemReportsOffered,
  resetProblemReportProbe,
  resetSelfRemovalProbe,
} from '../../packages/auth/src/problem-reports';

// The one answer the Help menus and the closed-account screen depend on: Report a Problem is offered only when the
// problem report module AND the customer's own word removal (migration 0003) are both installed. The two checks read the
// catalogue; here the catalogue is a fake that answers each one, so all four combinations and a failed read are seen
// without a database.
function catalogue(installed: boolean, removal: boolean) {
  const asked: string[] = [];
  return {
    asked,
    query: async (sql: string) => {
      asked.push(sql.includes("'problem_report_remove_own_words'") ? 'removal' : 'module');
      return sql.includes("'problem_report_remove_own_words'")
        ? { rows: [{ available: removal }] }
        : { rows: [{ installed }] };
    },
  };
}

beforeEach(() => {
  resetProblemReportProbe();
  resetSelfRemovalProbe();
});

describe('problemReportsOffered', () => {
  test.each([
    { installed: true, removal: true, offered: true },
    { installed: true, removal: false, offered: false },
    { installed: false, removal: true, offered: false },
    { installed: false, removal: false, offered: false },
  ])(
    'module installed $installed and own word removal installed $removal is offered $offered',
    async ({ installed, removal, offered }) => {
      const db = catalogue(installed, removal);
      expect(await problemReportsOffered(db as never)).toBe(offered);
    },
  );

  test('a module that is not installed is not asked about word removal', async () => {
    const db = catalogue(false, true);
    await problemReportsOffered(db as never);
    expect(db.asked).toEqual(['module']);
  });

  test('a catalogue that cannot be read is not offered, and the next read is tried again', async () => {
    const broken = {
      query: async () => {
        throw new Error('connection lost');
      },
    };
    expect(await problemReportsOffered(broken as never)).toBe(false);
    expect(await problemReportsOffered(catalogue(true, true) as never)).toBe(true);
  });

  test('an installed module is remembered, so a later read costs no query', async () => {
    const db = catalogue(true, true);
    expect(await problemReportsOffered(db as never)).toBe(true);
    const asked = db.asked.length;
    expect(await problemReportsOffered(db as never)).toBe(true);
    expect(db.asked.length).toBe(asked);
  });
});
