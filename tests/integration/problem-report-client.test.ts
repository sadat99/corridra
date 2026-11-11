import { describe, expect, test } from 'vitest';
import { accountClosedCode } from '../../packages/auth/src/customer-account-gate';
import { limitWords } from '../../apps/web/lib/account-limit';
import {
  attemptFor,
  closedAccountCode,
  draftErrors,
  fileBody,
  fileFailure,
  fileProblemReport,
  readFailure,
  readFromPage,
  readProblemReport,
  readProblemReports,
  referenceAsked,
  removalFailure,
  removeOwnWords,
  type Draft,
} from '../../apps/web/lib/problem-report-client';
import {
  categoryWords,
  detailWords,
  failureWords,
  formWords,
  listWords,
  removalWords,
  reviewSentence,
  statusLabels,
  statusMeaning,
} from '../../apps/web/lib/problem-report-words';
import * as words from '../../apps/web/lib/problem-report-words';

// The Report a Problem screens (ADR-078, docs/revamp/specs/problem-reports.md sections 4 and 5) without a browser: what
// each answer of the routes means to a person, what the form checks before it sends, and what it sends. Every status the
// screens show has a row here; the same rows are asserted for filing, reading and removing.
const headers = {
  'x-corridra-customer-subject': 'synthetic-person',
  'x-corridra-customer-issuer': 'https://issuer.invalid',
};
const customer = { side: 'customer', headers } as const;
const team = { side: 'team', tenant: '00000000-0000-4000-8000-0000000000a1' } as const;

type Sent = { url: string; init: RequestInit };
function answer(status: number, body: unknown, sent: Sent[] = []) {
  return (async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}
const dropped = (async () => {
  throw new TypeError('network down');
}) as unknown as typeof fetch;

const draft = (over: Partial<Draft> = {}): Draft => ({
  category: 'did_not_work',
  where: 'this_page',
  pageText: '',
  detail: '',
  ...over,
});

describe('what a person reads for each answer while filing', () => {
  const rows: [string, number | null, string | null, string, string | null][] = [
    ['400 the server refused the words', 400, null, formWords.errorPlain, null],
    ['401 signed out', 401, null, failureWords.signedOut, 'sign_in'],
    ['403 role or account', 403, null, failureWords.forbidden, 'return'],
    ['403 closed account', 403, 'account_closed', failureWords.closed, 'list'],
    ['404 no such route', 404, null, failureWords.fileServer, null],
    ['409 a conflicting reuse of the command', 409, null, failureWords.fileServer, null],
    ['429 too many', 429, null, limitWords, null],
    [
      '503 not installed',
      503,
      null,
      `${failureWords.unavailable} ${failureWords.unavailableFile}`,
      null,
    ],
    ['500 any other server error', 500, null, failureWords.fileServer, null],
    ['502 a bad gateway', 502, null, failureWords.fileServer, null],
    ['no answer at all', null, null, failureWords.fileNetwork, null],
  ];
  test.each(rows)('%s', (_name, status, code, message, link) => {
    expect(fileFailure(status, code)).toEqual({ message, link });
  });
  test('the sentences are the spec words, word for word', () => {
    expect(failureWords.signedOut).toBe(
      'Your sign-in has ended. Sign in again, then come back to this form.',
    );
    expect(failureWords.forbidden).toBe(
      'You cannot report a problem from this account. Nothing was sent.',
    );
    expect(failureWords.fileNetwork).toBe(
      'Your problem report was not sent. Check your connection, then press Send Problem Report again. What you wrote is still here.',
    );
    expect(failureWords.fileServer).toBe(
      'Your problem report was not sent. Try again in a few minutes. What you wrote is still here.',
    );
    expect(failureWords.unavailable).toBe('Problem reports are not available yet.');
    expect(failureWords.unavailableFile).toBe(
      'You cannot report a problem here yet. Nothing was sent.',
    );
    expect(limitWords).toBe('The request limit was reached. Try again later.');
  });
  test('the closed account code is the one the server sends', () => {
    expect(closedAccountCode).toBe(accountClosedCode);
  });
  test('a closed account is told apart from any other 403, and the other 403 does not mention closing', () => {
    expect(fileFailure(403, 'account_closed').message).not.toBe(fileFailure(403, null).message);
    expect(fileFailure(403, null).message).not.toMatch(/closed/i);
    expect(fileFailure(403, 'something_else').message).toBe(failureWords.forbidden);
  });
});

describe('what a person reads for each answer while reading', () => {
  const generic = listWords.loadError;
  const rows: [string, number | null, string, string][] = [
    ['401', 401, failureWords.signedOut, 'sign_in'],
    ['403', 403, failureWords.readForbidden, ''],
    ['404 where a report is looked for', 404, detailWords.notFound, ''],
    ['429', 429, limitWords, ''],
    ['503', 503, failureWords.unavailable, ''],
    ['500', 500, generic, ''],
    ['400', 400, generic, ''],
    ['no answer at all', null, generic, ''],
  ];
  test.each(rows)('%s', (_name, status, message, link) => {
    expect(readFailure(status, generic, detailWords.notFound)).toEqual({
      message,
      link: link || null,
    });
  });
  test('a 404 on the list is the plain load error, since a list cannot be missing', () => {
    expect(readFailure(404, generic)).toEqual({ message: generic, link: null });
  });
  test('the not found words are the spec words', () => {
    expect(detailWords.notFound).toBe('We could not find this problem report.');
    expect(listWords.loadError).toBe(
      'Your problem reports could not be loaded. Check your connection and try again.',
    );
  });
});

describe('what a person reads for each answer while removing their words', () => {
  const rows: [string, number | null, string, string | null][] = [
    ['401', 401, failureWords.signedOutAgain, 'sign_in'],
    ['403', 403, failureWords.removalForbidden, null],
    ['429', 429, limitWords, null],
    ['503', 503, failureWords.unavailable, null],
    ['404', 404, failureWords.removalFailed, null],
    ['409', 409, failureWords.removalFailed, null],
    ['500', 500, failureWords.removalFailed, null],
    ['no answer at all', null, failureWords.removalFailed, null],
  ];
  test.each(rows)('%s', (_name, status, message, link) => {
    expect(removalFailure(status)).toEqual({ message, link });
  });
});

describe('the removed count comes only from the answer', () => {
  test.each([
    [2, 'Words removed from 2 reports.'],
    [1, 'Words removed from 1 report.'],
    [0, 'You have no words left to remove.'],
  ])('%i removed says %s', async (removed, line) => {
    const reply = await removeOwnWords(
      headers,
      'c-1',
      answer(200, { removed, changed: removed > 0 }),
    );
    expect(reply.ok && removalWords.done(reply.value.removed)).toBe(line);
  });
  test('an answer without a count is no answer, so the same command is sent again', async () => {
    for (const body of [{}, { removed: -1 }, { removed: 1.5 }, { removed: '3' }, null]) {
      const reply = await removeOwnWords(headers, 'c-1', answer(200, body));
      expect(reply, JSON.stringify(body)).toEqual({ ok: false, status: null, code: null });
    }
  });
  test('it sends the command id and nothing else of its own, with the session headers of the page', async () => {
    const sent: Sent[] = [];
    await removeOwnWords(headers, 'c-7', answer(200, { removed: 0, changed: false }, sent));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe('/api/customer-problem-reports');
    expect(sent[0]!.init.method).toBe('POST');
    expect(JSON.parse(String(sent[0]!.init.body))).toEqual({
      action: 'remove_words',
      commandId: 'c-7',
    });
    expect(sent[0]!.init.headers).toMatchObject(headers);
  });
  test('a dropped connection and every refusal give no count', async () => {
    expect(await removeOwnWords(headers, 'c', dropped)).toEqual({
      ok: false,
      status: null,
      code: null,
    });
    for (const status of [400, 401, 403, 404, 409, 429, 503, 500])
      expect(await removeOwnWords(headers, 'c', answer(status, { error: 'no' }))).toEqual({
        ok: false,
        status,
        code: null,
      });
  });
});

describe('filing sends the words the person wrote and a command id', () => {
  const body = {
    category: 'did_not_work',
    pageKind: 'this_page',
    page: '/account/requests',
  } as const;
  test('the customer sends no person, side or action, only the words and the command id', async () => {
    const sent: Sent[] = [];
    const reply = await fileProblemReport(
      customer,
      'cmd-1',
      body,
      answer(
        200,
        { reference: 'RP-000123', status: 'received', filedAt: 'x', changed: true },
        sent,
      ),
    );
    expect(reply.ok && reply.value.reference).toBe('RP-000123');
    expect(sent[0]!.url).toBe('/api/customer-problem-reports');
    expect(JSON.parse(String(sent[0]!.init.body))).toEqual({ commandId: 'cmd-1', ...body });
    expect(sent[0]!.init.headers).toMatchObject(headers);
  });
  test('the team member files through the team route, in the chosen workspace, with the file action', async () => {
    const sent: Sent[] = [];
    await fileProblemReport(team, 'cmd-2', body, answer(200, { reference: 'RP-000124' }, sent));
    expect(sent[0]!.url).toBe(`/api/workspace/problem-reports?tenant=${team.tenant}`);
    expect(JSON.parse(String(sent[0]!.init.body))).toEqual({
      action: 'file',
      commandId: 'cmd-2',
      ...body,
    });
    expect(JSON.stringify(sent[0]!.init.headers)).not.toMatch(/customer/);
  });
  test('an answer that is not a reference is no answer', async () => {
    expect(await fileProblemReport(customer, 'c', body, answer(200, { ok: true }))).toEqual({
      ok: false,
      status: null,
      code: null,
    });
  });
  test('a refusal keeps its status and its code, and a dropped connection has neither', async () => {
    expect(
      await fileProblemReport(
        customer,
        'c',
        body,
        answer(403, { error: 'x', code: 'account_closed' }),
      ),
    ).toEqual({ ok: false, status: 403, code: 'account_closed' });
    expect(await fileProblemReport(customer, 'c', body, dropped)).toEqual({
      ok: false,
      status: null,
      code: null,
    });
  });
});

describe('reading', () => {
  test('the list asks for five at a time and, for older ones, the number to start before', async () => {
    const sent: Sent[] = [];
    await readProblemReports(customer, 5, null, answer(200, { items: [], nextBefore: null }, sent));
    await readProblemReports(customer, 5, 17, answer(200, { items: [], nextBefore: null }, sent));
    expect(sent.map((call) => call.url)).toEqual([
      '/api/customer-problem-reports?pageSize=5',
      '/api/customer-problem-reports?pageSize=5&beforeNumber=17',
    ]);
    expect(sent.every((call) => call.init.method === 'GET')).toBe(true);
  });
  test('the team member reads their own with view=mine in the chosen workspace', async () => {
    const sent: Sent[] = [];
    await readProblemReports(team, 5, null, answer(200, { items: [], nextBefore: null }, sent));
    const url = new URL(sent[0]!.url, 'https://example.invalid');
    expect(url.pathname).toBe('/api/workspace/problem-reports');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      view: 'mine',
      pageSize: '5',
      tenant: team.tenant,
    });
  });
  test('an answer that is not a list is no answer', async () => {
    expect(await readProblemReports(customer, 5, null, answer(200, { nope: 1 }))).toEqual({
      ok: false,
      status: null,
      code: null,
    });
  });
  test('one report is asked for by its reference', async () => {
    const sent: Sent[] = [];
    await readProblemReport(customer, 'RP-000123', answer(200, { reference: 'RP-000123' }, sent));
    expect(sent[0]!.url).toBe('/api/customer-problem-reports?reference=RP-000123');
    expect(await readProblemReport(customer, 'RP-1', answer(404, { error: 'x' }))).toEqual({
      ok: false,
      status: 404,
      code: null,
    });
  });
  test('a reference that could not exist is not asked for', () => {
    expect(referenceAsked('RP-000123')).toBe(true);
    expect(referenceAsked('')).toBe(false);
    expect(referenceAsked('x'.repeat(65))).toBe(false);
    expect(referenceAsked('RP-1\u0000')).toBe(false);
  });
});

describe('one command id for one send', () => {
  test('a retry of the same words keeps the id, and other words get a new one', () => {
    let made = 0;
    const make = () => `id-${++made}`;
    const first = attemptFor(null, 'words', make);
    expect(attemptFor(first, 'words', make)).toBe(first);
    expect(attemptFor(first, 'more words', make).id).toBe('id-2');
    expect(made).toBe(2);
  });
});

describe('the checks of the first step', () => {
  test('nothing chosen asks for the category, in the spec words', () => {
    expect(draftErrors(draft({ category: '' }))).toEqual({ category: 'Choose what went wrong.' });
  });
  test('Another page needs a page or screen, and a link or email in it is refused', () => {
    expect(draftErrors(draft({ where: 'another_page', pageText: '  ' }))).toEqual({
      page: 'Write which page or screen.',
    });
    expect(draftErrors(draft({ where: 'another_page', pageText: 'Requests' }))).toEqual({});
    expect(
      draftErrors(draft({ where: 'another_page', pageText: 'see www.example.com' })).page,
    ).toBe(formWords.errorPlain);
  });
  test('Something else needs at least 10 characters, counted as the database counts them', () => {
    const base = draft({ category: 'something_else' });
    expect(draftErrors({ ...base, detail: '123456789' })).toEqual({
      detail: 'Write at least 10 characters about what happened.',
    });
    expect(draftErrors({ ...base, detail: '1234567890' })).toEqual({});
    // Ten code points in nine UTF-16 units each pair, so counting units would pass nine of them.
    expect(draftErrors({ ...base, detail: '😀'.repeat(9) }).detail).toBeDefined();
    expect(draftErrors({ ...base, detail: '😀'.repeat(10) })).toEqual({});
    // Line breaks become one space and the ends are trimmed before counting, as the server reads it.
    expect(draftErrors({ ...base, detail: ' a\n\n\nb ' }).detail).toBeDefined();
  });
  test('the other categories may leave the detail empty, but not put a web or email address in it', () => {
    expect(draftErrors(draft({ detail: '' }))).toEqual({});
    expect(draftErrors(draft({ detail: 'write to me at a@b.example' })).detail).toBe(
      formWords.errorPlain,
    );
    expect(draftErrors(draft({ detail: 'see https://x.example' })).detail).toBe(
      formWords.errorPlain,
    );
  });
  test('every error is reported at once, in the order of the form', () => {
    expect(
      Object.keys(draftErrors(draft({ category: '', where: 'another_page', pageText: '' }))),
    ).toEqual(['category', 'page']);
  });
});

describe('the body of a send', () => {
  test('This page sends the masked path, and the detail is its one-line form without empty keys', () => {
    expect(fileBody(draft({ detail: ' It  broke\n\nagain ' }), '/account/requests/:id')).toEqual({
      category: 'did_not_work',
      pageKind: 'this_page',
      page: '/account/requests/:id',
      detail: 'It  broke again',
    });
    expect(fileBody(draft(), '/account')).not.toHaveProperty('detail');
  });
  test('Another page sends the words of the person, trimmed', () => {
    expect(
      fileBody(
        draft({ where: 'another_page', pageText: '  Requests  ', category: 'words_wrong' }),
        '/account',
      ),
    ).toEqual({ category: 'words_wrong', pageKind: 'another_page', page: 'Requests' });
  });
});

describe('the page a person came from', () => {
  test('a page of the shell is kept masked, and Go Back leads to the real path', () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    expect(readFromPage(`/account/requests/${id}`, 'customer')).toEqual({
      masked: '/account/requests/:id',
      returnTo: `/account/requests/${id}`,
    });
    expect(readFromPage(['/account/meetings', '/x'], 'customer')?.masked).toBe('/account/meetings');
  });
  test('the query and the fragment are never kept', () => {
    const from = readFromPage('/account/requests?token=abc#top', 'customer');
    expect(from).toEqual({ masked: '/account/requests', returnTo: '/account/requests' });
  });
  test('anything that is not a path of the person own shell is no page, so the form asks which one', () => {
    for (const raw of [
      undefined,
      '',
      'https://evil.example/account',
      '//evil.example/account',
      '/\\evil.example',
      '/operator/missions',
      '/plan',
      'account/requests',
    ])
      expect(readFromPage(raw, 'customer'), String(raw)).toBeNull();
    // The team member's shell is the other way round.
    expect(readFromPage('/account/requests', 'team')).toBeNull();
    expect(readFromPage('/operator/missions', 'team')?.masked).toBe('/operator/missions');
  });
});

// En and em dash, written as escapes so the source carries none.
const dashes = /[\u2013\u2014]/;

describe('the words', () => {
  test('there is no em dash or en dash anywhere in them', () => {
    expect(JSON.stringify(words)).not.toMatch(dashes);
    for (const text of [
      formWords.sentReference('RP-000123'),
      removalWords.done(3),
      reviewSentence('team'),
    ])
      expect(text).not.toMatch(dashes);
  });
  test('the categories, hints and statuses are the spec words', () => {
    expect(Object.values(categoryWords).map((c) => c.label)).toEqual([
      'Something did not work',
      'I could not find something',
      'Words or information are wrong',
      'Something else',
    ]);
    expect(Object.values(statusLabels)).toEqual(['Received', 'In review', 'Resolved', 'Closed']);
    expect(statusMeaning('in_review', 'customer')).toBe(
      'Someone in the Corridra team is looking at it.',
    );
    expect(statusMeaning('in_review', 'team')).toBe('An owner or admin is looking at it.');
    expect(reviewSentence('customer')).toBe('The Corridra team will review it.');
    expect(reviewSentence('team')).toBe('An owner or admin will review it.');
  });
  test('every button and link action is in Title Case', () => {
    const actions = [
      formWords.continue,
      formWords.notNow,
      formWords.send,
      formWords.back,
      formWords.edit,
      formWords.editWhat,
      formWords.editWhere,
      formWords.editDetail,
      formWords.seeList,
      formWords.goBack,
      listWords.report,
      listWords.tryAgain,
      listWords.showOlder,
      listWords.meaningTitle,
      removalWords.button,
      removalWords.confirm,
      removalWords.keep,
      failureWords.signIn,
      failureWords.returnCustomer,
      failureWords.returnTeam,
    ];
    const small = ['a', 'an', 'the', 'to', 'of', 'and', 'or', 'in', 'for', 'on'];
    for (const action of actions)
      action
        .split(' ')
        .forEach((word, index) =>
          expect(word, action).toMatch(index > 0 && small.includes(word) ? /^[a-z]+$/ : /^[A-Z]/),
        );
  });
});
