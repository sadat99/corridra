import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// The staff queue of problem reports and the owner's removal of words under an erasure request (ADR-078 decisions 6 and 8,
// docs/revamp/specs/problem-reports.md section 6), without a browser or a database: who sees the panel, what each status
// offers, every refusal in its own words, the fresh authenticator check that keeps the note, and a removed count that
// exists only after the answer. The same flows in a browser are tests/operator/problem-report-queue.spec.ts.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (type: unknown, props?: unknown) => unknown;
const renderToString = web('react-dom/server').renderToString as (element: unknown) => string;
const load = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
const source = (path: string) => readFileSync(resolve('apps/web', path), 'utf8');
const roles = ['owner', 'admin', 'operator', 'reviewer', 'viewer'] as const;
const statuses = ['received', 'in_review', 'resolved', 'closed'] as const;
const stepUpCode = 'STEP_UP_REQUIRED';

const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

// The dialog of the team shell answers the step-up event; here a stub window does, so the retry is seen without a browser.
function stubDialog(verified: boolean) {
  const asked = vi.fn();
  vi.stubGlobal('window', {
    dispatchEvent: (event: CustomEvent<{ resolve: (ok: boolean) => void }>) => {
      asked();
      event.preventDefault();
      event.detail.resolve(verified);
      return false;
    },
  });
  return asked;
}
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('who sees the queue and who may remove words', () => {
  test.each(roles)('%s: the panel is drawn for owners and admins only', async (role) => {
    const { ProblemReportQueue } = await load('app/operator/problem-report-queue.tsx');
    const html = renderToString(createElement(ProblemReportQueue, { tenant: 'tenant-one', role }));
    expect(html.includes('Load Problem Reports')).toBe(role === 'owner' || role === 'admin');
    if (role !== 'owner' && role !== 'admin') expect(html).toBe('');
  });
  test('an unknown or missing role draws nothing', async () => {
    const { ProblemReportQueue } = await load('app/operator/problem-report-queue.tsx');
    for (const role of ['', 'Owner', 'superuser'])
      expect(renderToString(createElement(ProblemReportQueue, { tenant: 't', role }))).toBe('');
  });
  test.each(roles)(
    '%s: only the owner is offered the removal under an erasure request',
    async (role) => {
      const { canRemoveWords, canTriage } = await load('lib/problem-report-queue.ts');
      expect(canRemoveWords(role)).toBe(role === 'owner');
      expect(canTriage(role)).toBe(role === 'owner' || role === 'admin');
      expect(canRemoveWords(null)).toBe(false);
      expect(canTriage(undefined)).toBe(false);
    },
  );
});

describe('the panel before anything is loaded', () => {
  test('one closed disclosure whose summary is the heading, with the filter and the load button, and no figure', async () => {
    const { ProblemReportQueue } = await load('app/operator/problem-report-queue.tsx');
    const html = renderToString(
      createElement(ProblemReportQueue, { tenant: 'tenant-one', role: 'admin' }),
    );
    expect(html).toMatch(/<details[^>]*id="problem-report-queue"/);
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
    expect(html).toContain('<summary><h2>Problem reports</h2></summary>');
    expect(html).toContain('Customers and team members report problems with Corridra here.');
    expect(html).toContain('Show');
    for (const label of ['All', 'Received', 'In review', 'Resolved', 'Closed'])
      expect(html, label).toContain(label);
    expect(html).toContain('Load Problem Reports');
    // Nothing is counted, summed or aged before a read: no figure, no list, no row.
    expect(html).not.toMatch(/waiting|Showing|Oldest|ux-segment-count|<li/);
    expect(html.replace(/<[^>]*>/g, ' ')).not.toMatch(/\d/);
  });
  test.each(roles)(
    '%s: the removal under an erasure request needs the owner, the offered flag and an in-progress or completed request',
    async (role) => {
      const { removalOnRequest } = await load('lib/problem-report-queue.ts');
      const statuses = ['received', 'in_progress', 'completed', 'declined'];
      for (const status of statuses) {
        const expected = role === 'owner' && (status === 'in_progress' || status === 'completed');
        expect(removalOnRequest(role, true, status), `${role} ${status} offered`).toBe(expected);
        expect(removalOnRequest(role, false, status), `${role} ${status} not offered`).toBe(false);
      }
    },
  );
  test('the erasure queue takes the offered flag as a prop and, when it is missing, adds no button', () => {
    const text = source('app/operator/erasure-queue.tsx');
    expect(text).toMatch(/problemReports\?: boolean/);
    expect(text).toContain('function Queue({ tenant, role, problemReports = false }: Props)');
  });
  test('the erasure queue draws no removal before a read, for any role', async () => {
    const { ErasureQueue } = await load('app/operator/erasure-queue.tsx');
    for (const role of [...roles, undefined]) {
      const html = renderToString(createElement(ErasureQueue, { tenant: 'tenant-one', role }));
      expect(html).toContain('Load Erasure Requests');
      expect(html).not.toMatch(/Remove Words|Words removed/);
    }
  });
});

describe('every status the queue shows', () => {
  test('offers exactly the moves the database allows, with the note rule of each', async () => {
    const { movesFrom } = await load('lib/problem-report-queue.ts');
    expect(movesFrom('received')).toEqual([
      { to: 'in_review', label: 'Start Review', noteRequired: false },
      { to: 'closed', label: 'Mark Closed', noteRequired: true },
    ]);
    expect(movesFrom('in_review')).toEqual([
      { to: 'resolved', label: 'Mark Resolved', noteRequired: true },
      { to: 'closed', label: 'Mark Closed', noteRequired: true },
    ]);
    expect(movesFrom('resolved')).toEqual([]);
    expect(movesFrom('closed')).toEqual([]);
  });
  test('every status has a word, every reporter kind a label, and the filter lists them all', async () => {
    const { reporterKindLabels } = await load('lib/problem-report-queue.ts');
    const { statusLabels } = await load('lib/problem-report-words.ts');
    for (const status of statuses) expect(statusLabels[status]).toBeTruthy();
    expect(reporterKindLabels).toEqual({ customer: 'Customer', team: 'Team member' });
    const component = source('app/operator/problem-report-queue.tsx');
    expect(component).toContain('problemReportStatuses.map');
  });
});

describe('the note a move needs', () => {
  test('required: 10 to 1000 characters of plain text, counted as the database counts', async () => {
    const { noteProblem, queueWords } = await load('lib/problem-report-queue.ts');
    expect(noteProblem('', true)).toBe(queueWords.noteLength);
    expect(noteProblem('too short', true)).toBe(queueWords.noteLength);
    expect(noteProblem('x'.repeat(9), true)).toBe(queueWords.noteLength);
    expect(noteProblem('x'.repeat(10), true)).toBeNull();
    expect(noteProblem('x'.repeat(1000), true)).toBeNull();
    expect(noteProblem('x'.repeat(1001), true)).toBe(queueWords.noteLength);
    expect(noteProblem('\u{1F600}'.repeat(10), true)).toBeNull();
    expect(noteProblem('   short   ', true)).toBe(queueWords.noteLength);
  });
  test('optional (Start Review): empty is fine, but a note that is written follows the same rule', async () => {
    const { noteProblem, queueWords } = await load('lib/problem-report-queue.ts');
    expect(noteProblem('', false)).toBeNull();
    expect(noteProblem('   ', false)).toBeNull();
    expect(noteProblem('short', false)).toBe(queueWords.noteLengthOptional);
    expect(noteProblem('Looking into it now.', false)).toBeNull();
  });
  test('web addresses, email markers and control characters are refused with the plain-text words', async () => {
    const { noteProblem } = await load('lib/problem-report-queue.ts');
    const { formWords } = await load('lib/problem-report-words.ts');
    for (const note of [
      'See https://example.invalid for more',
      'Write to someone@example.invalid',
      'a note with a \u0007 bell in it',
    ])
      expect(noteProblem(note, true), note).toBe(formWords.errorPlain);
    // A line break is the one thing made safe, not refused: the note is sent as one line.
    expect(noteProblem('first line here\nsecond line here', true)).toBeNull();
  });
});

describe('what the summary lines say', () => {
  const counts = { received: 3, in_review: 1, resolved: 4, closed: 2 };
  const now = new Date('2026-11-10T12:00:00Z');
  test('the total counts every status, and waiting is the Received figure', async () => {
    const { queueTotal, queueWords } = await load('lib/problem-report-queue.ts');
    expect(queueTotal(counts)).toBe(10);
    expect(queueWords.waiting(3, 10)).toBe('3 of 10 waiting');
    expect(queueWords.summary(10, 40)).toBe('Showing 10 of 40 problem reports.');
    expect(queueWords.summary(1, 1)).toBe('Showing 1 of 1 problem report.');
  });
  test('Oldest waiting names the date with its zone and the age, or says why there is none', async () => {
    const { oldestWaitingLine } = await load('lib/problem-report-queue.ts');
    const base = { items: [], total: 0, nextAfter: null };
    expect(
      oldestWaitingLine({ ...base, counts, oldestReceivedAt: '2026-11-06T09:12:00Z' }, now),
    ).toBe('Oldest waiting: filed 6 Nov 2026, 09:12 (UTC), 4 days ago.');
    expect(
      oldestWaitingLine({ ...base, counts, oldestReceivedAt: '2026-11-09T09:12:00Z' }, now),
    ).toBe('Oldest waiting: filed 9 Nov 2026, 09:12 (UTC), 1 day ago.');
    expect(
      oldestWaitingLine({ ...base, counts, oldestReceivedAt: '2026-11-10T09:12:00Z' }, now),
    ).toBe('Oldest waiting: filed 10 Nov 2026, 09:12 (UTC), today.');
    expect(
      oldestWaitingLine(
        { ...base, counts: { ...counts, received: 0 }, oldestReceivedAt: null },
        now,
      ),
    ).toBe('No problem report is waiting in Received.');
    expect(oldestWaitingLine({ ...base, counts, oldestReceivedAt: null }, now)).toBe(
      'Oldest waiting: Not measured yet.',
    );
  });
});

describe('every refusal has its own words, and says what to do next', () => {
  async function failureFor(
    status: number | null,
    doing: 'load' | 'move' | 'remove',
    code?: string,
  ) {
    const { queueFailure } = await load('lib/problem-report-queue.ts');
    const { ActionError } = await load('lib/ux/step-up.ts');
    return queueFailure(
      status === null
        ? new TypeError('Failed to fetch')
        : new ActionError(
            code ? 'Confirm your authenticator code to finish this. Your changes are kept.' : 'x',
            status,
            code,
          ),
      doing,
    );
  }
  test('moving: 400, 401, 403, 404, 409, 429, 503, another 5xx and a dropped connection', async () => {
    const { queueWords } = await load('lib/problem-report-queue.ts');
    const { limitWords } = await load('lib/account-limit.ts');
    expect(await failureFor(400, 'move')).toMatchObject({ message: queueWords.invalid });
    expect(await failureFor(401, 'move')).toMatchObject({
      message: 'Your sign-in has ended. Sign in again, then try again.',
      signIn: true,
    });
    expect(await failureFor(403, 'move')).toMatchObject({
      message: 'This role cannot manage problem reports.',
    });
    expect(await failureFor(404, 'move')).toMatchObject({
      message: queueWords.notFound,
      reload: true,
    });
    expect(await failureFor(409, 'move')).toMatchObject({
      message: 'This problem report has changed. Reload and try again.',
      reload: true,
    });
    expect(await failureFor(429, 'move')).toMatchObject({ message: limitWords });
    expect(await failureFor(503, 'move')).toMatchObject({
      message: 'Problem reports are not available yet.',
    });
    expect(await failureFor(500, 'move')).toMatchObject({ message: queueWords.moveFailed });
    expect(await failureFor(502, 'move')).toMatchObject({ message: queueWords.moveFailed });
    expect(await failureFor(null, 'move')).toMatchObject({ message: queueWords.moveFailed });
    // Only a stale report offers Reload; the note is said to be kept wherever a retry is the way forward.
    for (const status of [400, 401, 403, 429, 503, 500, null])
      expect((await failureFor(status, 'move')).reload, String(status)).toBe(false);
    expect(queueWords.moveFailed).toContain('Your note is kept.');
  });
  test('loading: the plain read failure, the refusals, and the sign-in way out', async () => {
    const { queueWords } = await load('lib/problem-report-queue.ts');
    expect(await failureFor(null, 'load')).toMatchObject({ message: queueWords.loadFailed });
    expect(await failureFor(500, 'load')).toMatchObject({ message: queueWords.loadFailed });
    expect(await failureFor(403, 'load')).toMatchObject({ message: queueWords.forbidden });
    expect(await failureFor(401, 'load')).toMatchObject({ signIn: true });
    expect(await failureFor(503, 'load')).toMatchObject({ message: queueWords.unavailable });
  });
  test('removing words: 403 for a role that is not owner, 503, 409, 401 and a dropped connection', async () => {
    expect(await failureFor(403, 'remove')).toMatchObject({
      message: 'Only an owner can remove words under an erasure request.',
    });
    expect(await failureFor(503, 'remove')).toMatchObject({
      message: 'Problem reports are not available yet.',
    });
    expect((await failureFor(409, 'remove')).message).toContain('Reload the list.');
    expect(await failureFor(401, 'remove')).toMatchObject({ signIn: true });
    for (const status of [null, 500]) {
      const failure = await failureFor(status, 'remove');
      expect(failure.message).toBe(
        'The words were not removed. Check your connection and try again.',
      );
    }
  });
  test('a fresh authenticator check that was not completed says the library words, whichever the call', async () => {
    for (const doing of ['load', 'move', 'remove'] as const)
      expect((await failureFor(401, doing, stepUpCode)).message).toBe(
        'Confirm your authenticator code to finish this. Your changes are kept.',
      );
  });
});

describe('a fresh authenticator check keeps the note and ends in a retry', () => {
  const move = {
    commandId: '11111111-1111-4111-8111-111111111111',
    reportId: '22222222-2222-4222-8222-222222222222',
    expectedState: 'in_review' as const,
    toState: 'resolved' as const,
    note: 'We fixed the button\non the requests page.',
  };
  const needed = () => answer(401, { error: 'Verify again.', code: stepUpCode });
  const moved = () =>
    answer(200, {
      id: move.reportId,
      reference: 'RP-000002',
      status: 'resolved',
      note: 'ok',
      changed: true,
    });

  test('verified: the same move is sent again once, unchanged, and the answer is the result', async () => {
    const asked = stubDialog(true);
    const { moveReport } = await load('lib/problem-report-queue.ts');
    const fetcher = vi.fn().mockResolvedValueOnce(needed()).mockResolvedValueOnce(moved());
    const done = await moveReport('tenant-one', move, fetcher);
    expect(done.status).toBe('resolved');
    expect(asked).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]![1].body).toBe(fetcher.mock.calls[1]![1].body);
    const body = JSON.parse(fetcher.mock.calls[1]![1].body);
    expect(body).toEqual({
      action: 'transition',
      commandId: move.commandId,
      reportId: move.reportId,
      expectedState: 'in_review',
      toState: 'resolved',
      note: 'We fixed the button on the requests page.',
    });
    expect(fetcher.mock.calls[1]![0]).toBe('/api/workspace/problem-reports?tenant=tenant-one');
  });
  test('not completed: nothing is sent twice, the failure carries the library words, and Save tries the same command again', async () => {
    stubDialog(false);
    const { moveReport, queueFailure } = await load('lib/problem-report-queue.ts');
    const fetcher = vi.fn().mockResolvedValueOnce(needed()).mockResolvedValueOnce(moved());
    const error = await moveReport('tenant-one', move, fetcher).catch((e: unknown) => e);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(queueFailure(error, 'move')).toEqual({
      message: 'Confirm your authenticator code to finish this. Your changes are kept.',
      reload: false,
      signIn: false,
    });
    stubDialog(true);
    fetcher.mockResolvedValueOnce(needed()).mockResolvedValueOnce(moved());
    expect((await moveReport('tenant-one', move, fetcher)).status).toBe('resolved');
    const ids = fetcher.mock.calls.map((call) => JSON.parse(call[1].body).commandId);
    expect(new Set(ids)).toEqual(new Set([move.commandId]));
  });
  test('an empty note is not sent at all (Start Review), and the optional note is sent as one line', async () => {
    const { moveReport } = await load('lib/problem-report-queue.ts');
    const fetcher = vi.fn().mockImplementation(async () => moved());
    await moveReport(
      'tenant-one',
      { ...move, toState: 'in_review', expectedState: 'received', note: '  ' },
      fetcher,
    );
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).not.toHaveProperty('note');
  });
  test('the queue read asks for the step-up in the same way', async () => {
    stubDialog(true);
    const { readQueue } = await load('lib/problem-report-queue.ts');
    const page = {
      items: [],
      total: 0,
      counts: { received: 0, in_review: 0, resolved: 0, closed: 0 },
      oldestReceivedAt: null,
      nextAfter: null,
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(needed())
      .mockResolvedValueOnce(answer(200, page));
    expect(await readQueue('tenant-one', 'in_review', 40, fetcher)).toEqual(page);
    const url = new URL(fetcher.mock.calls[1]![0], 'https://page.invalid');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      tenant: 'tenant-one',
      view: 'queue',
      pageSize: '10',
      status: 'in_review',
      afterNumber: '40',
    });
    const all = vi.fn().mockResolvedValue(answer(200, page));
    await readQueue('tenant-one', 'all', null, all);
    expect(new URL(all.mock.calls[0]![0], 'https://page.invalid').searchParams.has('status')).toBe(
      false,
    );
  });
  test('an answer that is not a queue is a failure to read, never an empty list', async () => {
    const { readQueue, queueFailure } = await load('lib/problem-report-queue.ts');
    const error = await readQueue(
      't',
      'all',
      null,
      vi.fn().mockResolvedValue(answer(200, { items: 'x' })),
    ).catch((e: unknown) => e);
    expect(queueFailure(error, 'load').message).toContain('could not be loaded');
  });
});

describe('the removed count exists only after the answer', () => {
  const requestId = '33333333-3333-4333-8333-333333333333';
  const command = '44444444-4444-4444-8444-444444444444';
  test('nothing is read or sent until the call, and the count shown is the one answered', async () => {
    const { removeWordsUnderRequest, wordsRemovedMessage } = await load(
      'lib/problem-report-queue.ts',
    );
    const fetcher = vi
      .fn()
      .mockResolvedValue(answer(200, { reference: 'ERA-2026-0071', removed: 3 }));
    expect(fetcher).not.toHaveBeenCalled();
    const done = await removeWordsUnderRequest('tenant-one', command, requestId, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({
      action: 'remove_words',
      commandId: command,
      erasureRequestId: requestId,
    });
    expect(wordsRemovedMessage(done.removed)).toBe('Words removed from 3 problem reports.');
    expect(wordsRemovedMessage(1)).toBe('Words removed from 1 problem report.');
    expect(wordsRemovedMessage(0)).toBe('Words removed from 0 problem reports.');
  });
  test('an answer without a whole count is a failure, never a made-up number', async () => {
    const { removeWordsUnderRequest } = await load('lib/problem-report-queue.ts');
    for (const removed of [undefined, -1, 1.5, '3', null])
      await expect(
        removeWordsUnderRequest(
          'tenant-one',
          command,
          requestId,
          vi.fn().mockResolvedValue(answer(200, { reference: 'x', removed })),
        ),
      ).rejects.toMatchObject({ status: 502 });
  });
  test('a fresh authenticator check retries the same removal with the same command id', async () => {
    stubDialog(true);
    const { removeWordsUnderRequest } = await load('lib/problem-report-queue.ts');
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(answer(401, { error: 'x', code: stepUpCode }))
      .mockResolvedValueOnce(answer(200, { reference: 'ERA-2026-0071', removed: 2 }));
    expect((await removeWordsUnderRequest('t', command, requestId, fetcher)).removed).toBe(2);
    const ids = fetcher.mock.calls.map((call) => JSON.parse(call[1].body).commandId);
    expect(ids).toEqual([command, command]);
  });
  test('the erasure queue holds the control for the owner only, with a confirmation and no count of its own', () => {
    const text = source('app/operator/erasure-queue.tsx');
    expect(text).toContain('removalOnRequest(role, problemReports, i.status)');
    expect(text).toContain('wordsRemovedMessage(done.removed)');
    // The count is not read, summed or guessed anywhere else on the page.
    expect(text.match(/removed/g)?.length ?? 0).toBeLessThanOrEqual(4);
    expect(text).not.toMatch(/localStorage|sessionStorage/);
  });
});

describe('where the panel sits and how it is reached', () => {
  test('its address belongs to the settings panel, and the other fragments are untouched', async () => {
    const { panelFor } = await load('components/workspace-area-bar.tsx');
    expect(panelFor('problem-report-queue')).toBe('workspace-settings');
    expect(panelFor('ops-center')).toBe('workspace-operations');
    expect(panelFor('workspace-audit')).toBe('workspace-audit');
  });
  test('it is mounted directly after the erasure queue, inside the owner and admin gate, and nowhere else', () => {
    const text = source('app/operator/workspace.tsx');
    const gate = text.indexOf(
      "shown('workspace-settings') && ['owner', 'admin'].includes(data.role)",
    );
    const erasure = text.indexOf('<ErasureQueue');
    const queue = text.indexOf('<ProblemReportQueue');
    expect(gate).toBeGreaterThan(-1);
    expect(erasure).toBeGreaterThan(gate);
    expect(queue).toBeGreaterThan(erasure);
    expect(text.slice(erasure + '<ErasureQueue'.length, queue)).not.toMatch(
      /<[A-Z][A-Za-z]+Queue|<ReviewSettings/,
    );
    expect(text.match(/<ProblemReportQueue/g)).toHaveLength(1);
    // The address is allowed through the Settings section only, so other roles still get the same refusal as before.
    expect(text).toMatch(
      /const reportQueueAddress =\s+problemReports && fragment === problemReportQueueFragment;/,
    );
    expect(text).toMatch(/reportQueueAddress && section\.id === 'workspace-settings'/);
  });
  test('with Report a Problem not offered nothing is added: the panel is not mounted and its address is an unknown fragment', () => {
    const text = source('app/operator/workspace.tsx');
    // The flag is a prop the server decides, so it holds with the team shell off too; missing, it is false (fail closed).
    expect(text).toContain('problemReports = false,');
    expect(text).not.toMatch(/subscribeTeamFlags|readTeamFlags/);
    expect(text).toMatch(/<ErasureQueue[^>]*problemReports=\{problemReports\}/s);
    expect(text).toMatch(/\{problemReports \? \(\s+<ProblemReportQueue/);
    // Not offered, the address fails the same section check as any unknown fragment and lands on the navigation.
    expect(text).toMatch(/const unavailableSection =\s+!!fragment && fragment !== 'main'/);
    // The server entry reads the probe once, for the workspace itself, whether or not the team frame is there.
    const entry = source('app/operator/operator-entry.tsx');
    expect(entry).toContain(
      "import { problemReportsOffered } from '../../lib/problem-reports-offered';",
    );
    expect(entry).toMatch(/<Workspace[^>]*problemReports=\{await problemReportsOffered\(\)\}/s);
    const flags = source('lib/ux/team-flags.ts');
    expect(flags).toMatch(/empty: TeamFlags = \{ urls: false, problemReports: false \}/);
    expect(flags).toContain('readServerTeamFlags = () => empty');
  });
});

describe('the panel keeps its place while a person works', () => {
  const text = source('app/operator/problem-report-queue.tsx');
  test('a filter change drops the rows, the total and the cursor only; the counts, the oldest and a kept note stay', () => {
    const change = text.slice(
      text.indexOf('onChange={(value) => {'),
      text.indexOf('<div className="pr-actions">'),
    );
    expect(change).toContain('setPage(null)');
    expect(change).toContain('setItems([])');
    // The counts go only when the read after a saved move was abandoned (they would still show the pre-move figures).
    expect(change).toContain('if (reloading.current) setFigures(null);');
    expect(change.match(/setFigures/g)).toHaveLength(1);
    // The note typed for the open move is kept for its report before the form is dropped, and never lost.
    expect(change).toContain('if (pending) kept.current = { id: pending.item.id, text: note };');
    expect(change.indexOf('kept.current')).toBeLessThan(change.indexOf('setPending(null)'));
    // Every read takes its filter when it starts, so a filter changed during a save is not undone by the reload after it.
    expect(text).toContain('readQueue(tenant, filterRef.current, after)');
    expect(text).not.toMatch(/readQueue\(tenant, filter,/);
    expect(change).toContain('filterRef.current = value;');
    // Load More reads the cursor of the page that was read, which is gone until it is read again.
    expect(text).toContain('void load(page.nextAfter)');
    expect(text).toMatch(/\{page && !loadFailure \? \(/);
    expect(text).toMatch(/\{figures && !loadFailure \? \(/);
  });
  test('a failure line is built once per failure, so typing in the note never moves focus back to the line', () => {
    expect(text).toMatch(/useMemo\(\(\) => failureLine\(loadFailure\), \[loadFailure\]\)/);
    expect(text).toMatch(/useMemo\(\(\) => failureLine\(moveFailure\), \[moveFailure\]\)/);
    // No object made in the render is handed to the line: a new object on each key would refocus it each time.
    expect(text).not.toMatch(/failure=\{\{/);
  });
  test('Load More and the rows depend on the page being on screen, and the cursor is read from that page only', () => {
    expect(text).toMatch(/\{page && !loadFailure \? \(/);
    expect(text).toMatch(/page\.nextAfter !== null/);
  });
});

describe('the copy of the staff panel', () => {
  const files = [
    'lib/problem-report-queue.ts',
    'app/operator/problem-report-queue.tsx',
    'app/operator/erasure-queue.tsx',
  ];
  test('every sentence defined is used by a screen, and none is left without a place', async () => {
    const { queueWords, removalWordsUnderRequest } = await load('lib/problem-report-queue.ts');
    const queueSources = files.slice(0, 2).map(source).join('\n');
    for (const key of Object.keys(queueWords))
      expect(queueSources, `queueWords.${key}`).toContain(`queueWords.${key}`);
    const erasure = source('app/operator/erasure-queue.tsx');
    for (const key of Object.keys(removalWordsUnderRequest))
      expect(erasure, `removalWordsUnderRequest.${key}`).toContain(
        `removalWordsUnderRequest.${key}`,
      );
  });
  test('no em dash, no stored draft, no /account link', () => {
    for (const file of files) {
      const text = source(file);
      expect(text, file).not.toContain(String.fromCharCode(0x2014));
      expect(text, file).not.toMatch(/localStorage|sessionStorage/);
      expect(text, file).not.toMatch(/['"`]\/account/);
    }
  });
  test('the words the spec gives are exact', async () => {
    const { queueWords, removalWordsUnderRequest } = await load('lib/problem-report-queue.ts');
    expect(queueWords.noteLabel).toBe('Note to the reporter');
    expect(queueWords.caution).toBe(
      'The reporter will read this note. You cannot change or delete it after you save.',
    );
    expect(queueWords.noteHint).toBe(
      "Do not copy a reporter's words into a note; notes stay after the words are removed.",
    );
    expect(queueWords.showDetails).toBe('Show Details and History');
    expect([queueWords.save, queueWords.cancel, queueWords.reload]).toEqual([
      'Save',
      'Cancel',
      'Reload',
    ]);
    expect(removalWordsUnderRequest.button).toBe('Remove Words Under This Request');
    expect(removalWordsUnderRequest.body).toBe(
      'This removes the words of every problem report of this person filed up to this request. It cannot be undone. Notes stay.',
    );
  });
});
