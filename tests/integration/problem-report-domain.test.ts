import { describe, expect, it } from 'vitest';
import {
  customerProblemReportInput,
  oneLine,
  plainTextAllowed,
  plainTextBetween,
  problemReportListQuery,
  problemReportPathOk,
  problemReportQueueQuery,
  problemReportReference,
  sanitiseProblemPath,
  teamProblemReportAction,
  trimEdges,
} from '../../packages/domain/src/problem-report';
import { authorize, permissions } from '../../packages/domain/src/index';
import { staffCatalogueInput } from '../../packages/delivery/src/customer-service-staff';

// ADR-078 decision 3: one plain-text rule in packages/domain, the same set the database refuses from migration 0002.
// The edges of every range are tested on both sides. The database side of the same set is compared with this function
// in problem-report-services.test.ts.
const nbsp = String.fromCodePoint(0x00a0);
const separator = String.fromCodePoint(0x2028);
const at = (codePoint: number) => `a${String.fromCodePoint(codePoint)}b`;
const refused = [
  0x0000, 0x0001, 0x0009, 0x000a, 0x000d, 0x001f, 0x007f, 0x0080, 0x009f, 0x2028, 0x2029, 0x202a,
  0x202e, 0x2066, 0x2069,
];
const allowed = [0x0020, 0x007e, 0x00a0, 0x2027, 0x202f, 0x2065, 0x206a, 0x1f600, 0x00e9, 0x4e2d];
const customerBody = (over: Record<string, unknown> = {}) => ({
  commandId: '00000000-0000-4000-8000-000000000001',
  category: 'did_not_work',
  pageKind: 'this_page',
  page: '/account/requests',
  ...over,
});

describe('the plain-text rule', () => {
  for (const codePoint of refused)
    it(`refuses U+${codePoint.toString(16).padStart(4, '0')}`, () => {
      expect(plainTextAllowed(at(codePoint))).toBe(false);
      expect(plainTextBetween(at(codePoint), 1, 100)).toBe(false);
    });
  for (const codePoint of allowed)
    it(`allows U+${codePoint.toString(16).padStart(4, '0')}`, () => {
      expect(plainTextAllowed(at(codePoint))).toBe(true);
    });

  it('refuses a lone surrogate and allows a whole pair', () => {
    expect(plainTextAllowed('a\ud800b')).toBe(false);
    expect(plainTextAllowed('a\udfffb')).toBe(false);
    expect(plainTextAllowed('a😀b')).toBe(true);
  });

  it('refuses a web address and an email marker, case sensitively for www', () => {
    expect(plainTextAllowed('see https://example.invalid')).toBe(false);
    expect(plainTextAllowed('write to me@example.invalid')).toBe(false);
    expect(plainTextAllowed('open www.example.invalid')).toBe(false);
    expect(plainTextAllowed('open WWW.example.invalid')).toBe(true);
    expect(plainTextAllowed('about www and more')).toBe(true);
  });

  it('counts characters, not UTF-16 units', () => {
    expect(plainTextBetween('😀'.repeat(1000), 1, 1000)).toBe(true);
    expect(plainTextBetween('😀'.repeat(1001), 1, 1000)).toBe(false);
    expect(plainTextBetween('😀'.repeat(9), 10, 1000)).toBe(false);
    expect(plainTextBetween('😀'.repeat(10), 10, 1000)).toBe(true);
    expect(plainTextBetween('', 1, 10)).toBe(false);
  });
});

describe('the normal form of free text', () => {
  it('trims only spaces, tabs and line breaks at the ends', () => {
    expect(trimEdges(' \t\r\n a b \n\t ')).toBe('a b');
    expect(trimEdges(`${nbsp}a${nbsp}`)).toBe(`${nbsp}a${nbsp}`);
    expect(trimEdges(`${separator}a`)).toBe(`${separator}a`);
    expect(trimEdges(' \t\r\n')).toBe('');
  });
  it('turns each run of line breaks into one space', () => {
    expect(oneLine('one\ntwo\r\nthree\n\n\nfour')).toBe('one two three four');
    expect(oneLine('\n\none\n')).toBe('one');
    expect(oneLine('one\ttwo')).toBe('one\ttwo');
  });
});

describe('the path sanitiser', () => {
  it('keeps the pathname only, so a query or fragment never survives', () => {
    expect(sanitiseProblemPath('/account/requests?token=abc#top', 'customer')).toBe(
      '/account/requests',
    );
    expect(sanitiseProblemPath('/account?x=1', 'customer')).toBe('/account');
    for (const raw of ['/account/a%3Fb', '/account/a?b#c', '/operator/x#y']) {
      const path = sanitiseProblemPath(raw, raw.startsWith('/operator') ? 'team' : 'customer');
      expect(path).not.toBeNull();
      expect(path).not.toMatch(/[?#]/);
    }
  });
  it('turns every uuid into :id, in any case', () => {
    expect(
      sanitiseProblemPath(
        '/account/requests/3f2b8c1e-9a4d-4e57-8b21-0c6d5e7f1a90/edit',
        'customer',
      ),
    ).toBe('/account/requests/:id/edit');
    expect(
      sanitiseProblemPath('/operator/missions/3F2B8C1E-9A4D-4E57-8B21-0C6D5E7F1A90', 'team'),
    ).toBe('/operator/missions/:id');
  });
  it('accepts only the reporter own shell, otherwise the report is filed as Another page', () => {
    expect(sanitiseProblemPath('/operator/today', 'customer')).toBeNull();
    expect(sanitiseProblemPath('/account/requests', 'team')).toBeNull();
    expect(sanitiseProblemPath('/accounts', 'customer')).toBeNull();
    expect(sanitiseProblemPath('/signin', 'customer')).toBeNull();
    expect(sanitiseProblemPath('account/requests', 'customer')).toBeNull();
    expect(sanitiseProblemPath('//evil.invalid/account', 'customer')).toBeNull();
    expect(sanitiseProblemPath('https://evil.invalid/account', 'customer')).toBeNull();
    expect(sanitiseProblemPath('/account\\x', 'customer')).toBeNull();
    expect(sanitiseProblemPath('', 'customer')).toBeNull();
  });
  it('resolves dot segments so a path cannot climb out of its shell', () => {
    expect(sanitiseProblemPath('/account/../operator/today', 'customer')).toBeNull();
    expect(sanitiseProblemPath('/account/./requests', 'customer')).toBe('/account/requests');
  });
  it('allows 200 characters and no more', () => {
    const path = (length: number) => '/account/' + 'a'.repeat(length - '/account/'.length);
    expect(sanitiseProblemPath(path(200), 'customer')).toBe(path(200));
    expect(sanitiseProblemPath(path(201), 'customer')).toBeNull();
  });
  it('refuses a path that carries a link marker', () => {
    expect(sanitiseProblemPath('/account/a@b', 'customer')).toBeNull();
    expect(sanitiseProblemPath('/account/www.example', 'customer')).toBeNull();
  });
  it('agrees with the stored-path check: whatever it outputs is accepted', () => {
    for (const raw of ['/account', '/account/x/y', '/operator/settings']) {
      const reporter = raw.startsWith('/operator') ? 'team' : 'customer';
      const path = sanitiseProblemPath(raw, reporter);
      expect(path).not.toBeNull();
      expect(problemReportPathOk(path!, reporter)).toBe(true);
    }
    expect(problemReportPathOk('/account/x?y', 'customer')).toBe(false);
    expect(problemReportPathOk('/account/3f2b8c1e-9a4d-4e57-8b21-0c6d5e7f1a90', 'customer')).toBe(
      false,
    );
  });
});

describe('the filing input', () => {
  it('reads a report in its normal form and drops an empty detail', () => {
    const value = customerProblemReportInput.parse(
      customerBody({ detail: '  The save\nbutton did nothing.\n  ' }),
    );
    expect(value.detail).toBe('The save button did nothing.');
    expect(
      customerProblemReportInput.parse(customerBody({ detail: ' \n ' })).detail,
    ).toBeUndefined();
    expect(customerProblemReportInput.parse(customerBody({ detail: null })).detail).toBeUndefined();
  });
  it('refuses any key that names a person, a reporter or a side', () => {
    for (const key of ['personId', 'principalId', 'reporter', 'reporterKind', 'side', 'tenantId'])
      expect(customerProblemReportInput.safeParse(customerBody({ [key]: 'x' })).success).toBe(
        false,
      );
  });
  it('needs 10 characters of detail for Something else, counted after the line breaks collapse', () => {
    const body = (detail?: string) =>
      customerBody({ category: 'something_else', ...(detail === undefined ? {} : { detail }) });
    expect(customerProblemReportInput.safeParse(body()).success).toBe(false);
    expect(customerProblemReportInput.safeParse(body('123456789')).success).toBe(false);
    expect(customerProblemReportInput.safeParse(body('\n123456789\n')).success).toBe(false);
    expect(customerProblemReportInput.safeParse(body('12345\n6789')).success).toBe(true);
    expect(customerProblemReportInput.safeParse(body('😀'.repeat(10))).success).toBe(true);
    expect(customerProblemReportInput.safeParse(body('😀'.repeat(9))).success).toBe(false);
  });
  it('holds the detail to 1000 characters of plain text', () => {
    expect(
      customerProblemReportInput.safeParse(customerBody({ detail: '😀'.repeat(1000) })).success,
    ).toBe(true);
    expect(
      customerProblemReportInput.safeParse(customerBody({ detail: '😀'.repeat(1001) })).success,
    ).toBe(false);
    expect(customerProblemReportInput.safeParse(customerBody({ detail: 'a\tb' })).success).toBe(
      false,
    );
    expect(
      customerProblemReportInput.safeParse(customerBody({ detail: 'see www.example.invalid' }))
        .success,
    ).toBe(false);
  });
  it('does not join the page text onto one line: a line break there is refused', () => {
    const another = (page: string) => customerBody({ pageKind: 'another_page', page });
    expect(customerProblemReportInput.safeParse(another('Meetings')).success).toBe(true);
    expect(customerProblemReportInput.safeParse(another('Meet\nings')).success).toBe(false);
    expect(customerProblemReportInput.safeParse(another('  Meetings  ')).success).toBe(true);
    expect(customerProblemReportInput.safeParse(another('')).success).toBe(false);
    expect(customerProblemReportInput.safeParse(another('a'.repeat(120))).success).toBe(true);
    expect(customerProblemReportInput.safeParse(another('a'.repeat(121))).success).toBe(false);
    expect(
      customerProblemReportInput.safeParse(customerBody({ page: '/account/requests\n' })).success,
    ).toBe(true);
    expect(
      customerProblemReportInput.safeParse(customerBody({ page: '/account/re\nquests' })).success,
    ).toBe(false);
  });
  it('holds this page to the shell of the reporter, and no query or fragment', () => {
    for (const page of [
      '/account/x?y=1',
      '/account/x#y',
      '/operator/today',
      '/account/' + 'a'.repeat(200),
    ])
      expect(customerProblemReportInput.safeParse(customerBody({ page })).success).toBe(false);
    expect(
      teamProblemReportAction.safeParse({
        ...customerBody({ page: '/operator/today' }),
        action: 'file',
      }).success,
    ).toBe(true);
    expect(teamProblemReportAction.safeParse({ ...customerBody(), action: 'file' }).success).toBe(
      false,
    );
  });
});

describe('the team actions', () => {
  const move = (over: Record<string, unknown> = {}) => ({
    action: 'transition',
    commandId: '00000000-0000-4000-8000-000000000002',
    reportId: '00000000-0000-4000-8000-000000000003',
    expectedState: 'received',
    toState: 'in_review',
    ...over,
  });
  it('lets Start review go without a note and holds a note to 10 to 1000 plain characters', () => {
    expect(teamProblemReportAction.safeParse(move()).success).toBe(true);
    expect(teamProblemReportAction.safeParse(move({ note: 'short' })).success).toBe(false);
    expect(
      teamProblemReportAction.safeParse(move({ note: 'We are looking at it now.' })).success,
    ).toBe(true);
    expect(teamProblemReportAction.safeParse(move({ note: 'x'.repeat(1001) })).success).toBe(false);
  });
  it('needs a note to resolve or close, and reads a blank note as none', () => {
    for (const toState of ['resolved', 'closed']) {
      expect(
        teamProblemReportAction.safeParse(move({ expectedState: 'in_review', toState })).success,
      ).toBe(false);
      expect(
        teamProblemReportAction.safeParse(
          move({ expectedState: 'in_review', toState, note: ' \n ' }),
        ).success,
      ).toBe(false);
      expect(
        teamProblemReportAction.safeParse(
          move({ expectedState: 'in_review', toState, note: 'This was dealt with.' }),
        ).success,
      ).toBe(true);
    }
  });
  it('joins a note written over several lines, as the database does not', () => {
    const parsed = teamProblemReportAction.parse(
      move({ toState: 'closed', note: 'Duplicate of an\nearlier report.\n' }),
    );
    expect(parsed.action === 'transition' && parsed.note).toBe('Duplicate of an earlier report.');
  });
  it('refuses a final state as the state to leave, a person id and an unknown action', () => {
    expect(teamProblemReportAction.safeParse(move({ expectedState: 'resolved' })).success).toBe(
      false,
    );
    expect(teamProblemReportAction.safeParse(move({ toState: 'received' })).success).toBe(false);
    expect(teamProblemReportAction.safeParse(move({ personId: 'x' })).success).toBe(false);
    expect(teamProblemReportAction.safeParse({ action: 'delete' }).success).toBe(false);
    expect(
      teamProblemReportAction.safeParse({
        action: 'remove_words',
        commandId: '00000000-0000-4000-8000-000000000002',
        erasureRequestId: '00000000-0000-4000-8000-000000000004',
      }).success,
    ).toBe(true);
    expect(teamProblemReportAction.safeParse({ action: 'remove_words' }).success).toBe(false);
  });
});

describe('the queries', () => {
  it('pages the reporter list and the queue within bounds and refuses any other key', () => {
    expect(problemReportListQuery.parse({})).toEqual({ pageSize: 25 });
    expect(problemReportListQuery.parse({ beforeNumber: '9', pageSize: '100' })).toEqual({
      beforeNumber: 9,
      pageSize: 100,
    });
    for (const bad of [{ pageSize: '0' }, { pageSize: '101' }, { beforeNumber: '0' }, { x: '1' }])
      expect(problemReportListQuery.safeParse(bad).success).toBe(false);
    expect(problemReportQueueQuery.parse({ afterNumber: '0', status: 'received' })).toEqual({
      afterNumber: 0,
      pageSize: 25,
      status: 'received',
    });
    for (const bad of [{ status: 'bogus' }, { afterNumber: '-1' }, { personId: 'x' }])
      expect(problemReportQueueQuery.safeParse(bad).success).toBe(false);
  });
  it('sends a reference to the database only when it could be one', () => {
    expect(problemReportReference.safeParse('RP-000123').success).toBe(true);
    expect(problemReportReference.safeParse('x'.repeat(64)).success).toBe(true);
    expect(problemReportReference.safeParse('x'.repeat(65)).success).toBe(false);
    expect(problemReportReference.safeParse('').success).toBe(false);
    expect(problemReportReference.safeParse('RP-1\u0000').success).toBe(false);
    expect(problemReportReference.safeParse(5).success).toBe(false);
  });
});

describe('the staff permissions', () => {
  it('lets every role report a problem and only owners and admins triage', () => {
    expect(permissions['problems.report']).toEqual([
      'owner',
      'admin',
      'operator',
      'reviewer',
      'viewer',
    ]);
    expect(permissions['problems.triage']).toEqual(['owner', 'admin']);
    for (const role of ['operator', 'reviewer', 'viewer'] as const) {
      expect(() => authorize(role, 'problems.report')).not.toThrow();
      expect(() => authorize(role, 'problems.triage')).toThrow('Access denied');
    }
    for (const role of ['owner', 'admin'] as const)
      expect(() => authorize(role, 'problems.triage')).not.toThrow();
  });
});

describe('the delivery catalogue text uses the same rule', () => {
  const catalogue = (summary: string) => ({
    commandId: '00000000-0000-4000-8000-000000000005',
    serviceKey: 'site-visit',
    expectedVersion: 0,
    title: 'Site visit',
    summary,
    included: ['Visit'],
    excluded: ['Travel'],
    regions: ['DE'],
    quoteBasis: 'per_day',
    active: true,
  });
  it('still accepts plain words and refuses a link, an email marker and the wider control set', () => {
    expect(staffCatalogueInput.safeParse(catalogue('We visit the site for a day.')).success).toBe(
      true,
    );
    expect(staffCatalogueInput.safeParse(catalogue('Read https://example.invalid')).success).toBe(
      false,
    );
    expect(staffCatalogueInput.safeParse(catalogue('Write to me@example.invalid')).success).toBe(
      false,
    );
    expect(staffCatalogueInput.safeParse(catalogue('Tab\there is refused')).success).toBe(false);
    expect(
      staffCatalogueInput.safeParse(catalogue(`Next${String.fromCodePoint(0x0085)}line here`))
        .success,
    ).toBe(false);
  });
});
