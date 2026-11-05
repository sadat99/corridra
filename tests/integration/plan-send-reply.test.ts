import { describe, expect, it } from 'vitest';

// Wave 6 review finding on PR 288: a good status with an unreadable or wrong-shaped body is not a success on
// any of the three requests the request form sends. The pending save (account path, real use) has no browser
// harness here, so its rule is pinned on the reader the form uses for all three.
const load = async () => await import(/* @vite-ignore */ '../../apps/web/app/plan/send-reply');
const reply = (body: string, status = 201) => new Response(body, { status });

describe('a good answer must be readable and the shape the request needs', () => {
  it('send: a receipt, or a duplicate with no receipt, is a success; anything else is not', async () => {
    const { readSuccess, isSent } = await load();
    expect(await readSuccess(reply('{"receipt":"abc"}'), isSent)).toEqual({ receipt: 'abc' });
    expect(await readSuccess(reply('{"duplicate":true}'), isSent)).toEqual({ duplicate: true });
    for (const bad of ['', '<h1>ok</h1>', '{}', '[]', 'null', '{"receipt":7}'])
      await expect(readSuccess(reply(bad), isSent), bad).rejects.toThrow(/could not be completed/);
  });
  it('pending save: only { pending: true } is a success', async () => {
    const { readSuccess, isPendingSaved } = await load();
    expect(
      await readSuccess(reply('{"pending":true,"expiresAt":"x"}'), isPendingSaved),
    ).toMatchObject({
      pending: true,
    });
    for (const bad of ['', '<h1>ok</h1>', '{}', '{"pending":false}', '"ok"'])
      await expect(readSuccess(reply(bad), isPendingSaved), bad).rejects.toThrow(
        /could not be completed/,
      );
  });
  it('receipt check: a status and a list of replies, nothing else', async () => {
    const { readSuccess, isReceiptStatus } = await load();
    const good = { status: 'RECEIVED', replies: [{ body: 'x', createdAt: 'y' }] };
    expect(await readSuccess(reply(JSON.stringify(good), 200), isReceiptStatus)).toEqual(good);
    for (const bad of ['', '<h1>ok</h1>', '{}', '{"status":"X"}', '{"status":"X","replies":{}}'])
      await expect(readSuccess(reply(bad, 200), isReceiptStatus), bad).rejects.toThrow(
        /could not be completed/,
      );
  });
  it('a failed answer is read only for the sentence the server sent, and never throws', async () => {
    const { readFailure, wordsFor } = await load();
    expect(await readFailure(reply('<h1>down</h1>', 503))).toEqual({});
    expect(await readFailure(reply('{"error":"Too many"}', 429))).toEqual({ error: 'Too many' });
    expect(wordsFor(503, undefined)).toMatch(/could not be saved/);
    expect(wordsFor(429, '')).toMatch(/too many/i);
    expect(wordsFor(409, undefined)).toMatch(/changed/);
    expect(wordsFor(500, 'Server words')).toBe('Server words');
  });
});
