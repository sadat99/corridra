import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// CRUD G5, staff side: what the erasure queue says about a request. It names a reference, a state, the due date and
// whether the closed account can still be undone, and nothing else about the person. The queue has no scope control.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (type: unknown, props?: unknown) => unknown;
const renderToString = web('react-dom/server').renderToString as (element: unknown) => string;
const load = async () => await import('../../apps/web/app/operator/erasure-queue');

describe('the words staff read for a closed account', () => {
  it('says closed and final, or closed and until when it can be undone', async () => {
    const { accountText } = await load();
    expect(accountText({ accountStatus: 'final', undoUntil: null })).toBe('Closed, final');
    expect(accountText({ accountStatus: 'closed', undoUntil: '2026-12-02T00:00:00Z' })).toMatch(
      /^Closed, can be undone until .*2026/,
    );
    expect(accountText({ accountStatus: 'active', undoUntil: null })).toBe('Account still open');
  });
});

describe('the due words', () => {
  it('counts days left, names overdue, and stops counting once answered', async () => {
    const { dueText } = await load();
    const dueAt = '2026-12-01T00:00:00Z';
    expect(dueText({ status: 'received', daysLeft: 22, dueAt })).toMatch(/22 days left$/);
    expect(dueText({ status: 'received', daysLeft: 1, dueAt })).toMatch(/1 day left$/);
    expect(dueText({ status: 'in_progress', daysLeft: -3, dueAt })).toMatch(/^Overdue by 3 days/);
    expect(dueText({ status: 'completed', daysLeft: -3, dueAt })).toBe('Answered');
    expect(dueText({ status: 'declined', daysLeft: 5, dueAt })).toBe('Answered');
  });
});

describe('the queue before anything is loaded', () => {
  it('offers a status filter and a load button, and no scope, person or sample or real control', async () => {
    const { ErasureQueue } = await load();
    const html = renderToString(createElement(ErasureQueue, { tenant: 'tenant-one' }));
    expect(html).toContain('Erasure Requests');
    expect(html).toContain('Load Erasure Requests');
    expect(html).toContain('All requests');
    expect(html).not.toMatch(/scope|sample|real customer|principal/i);
    expect(html).not.toContain('—');
    expect(html).not.toContain('<li');
  });
});
