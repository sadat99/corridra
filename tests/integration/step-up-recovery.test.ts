import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isStepUpResponse,
  sendWithStepUp,
  stepUpEvent,
  stepUpKeptMessage,
  type StepUpRequest,
} from '../../apps/web/lib/ux/step-up';
import {
  SubmissionFailure,
  withStepUpSubmission,
} from '../../apps/web/components/retained-submission';

// Team desk v4.1 follow-up B (owner decision 26 Nov 2026): the shared recovery the staff screens use when the server
// refuses only because the authenticator check lapsed (401 STEP_UP_REQUIRED). It opens the existing in-place check (the
// same event StepUpDialog answers) and sends once more; it never sends again for any other refusal, and never twice.
const refused = () =>
  Response.json(
    { error: 'Verify your authenticator again to continue', code: 'STEP_UP_REQUIRED' },
    { status: 401 },
  );
let asked = 0;
function answerCheck(verified: boolean | null) {
  const target = new EventTarget();
  asked = 0;
  if (verified !== null)
    target.addEventListener(stepUpEvent, (event) => {
      event.preventDefault();
      asked += 1;
      (event as CustomEvent<StepUpRequest>).detail.resolve(verified);
    });
  (globalThis as { window?: unknown }).window = target;
}
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('isStepUpResponse', () => {
  it('is true only for 401 with the code, and leaves the body readable', async () => {
    const response = refused();
    expect(await isStepUpResponse(response)).toBe(true);
    expect(((await response.json()) as { code: string }).code).toBe('STEP_UP_REQUIRED');
    expect(await isStepUpResponse(Response.json({ error: 'no' }, { status: 401 }))).toBe(false);
    expect(
      await isStepUpResponse(Response.json({ code: 'STEP_UP_REQUIRED' }, { status: 403 })),
    ).toBe(false);
    expect(await isStepUpResponse(new Response('not json', { status: 401 }))).toBe(false);
  });
});

describe('sendWithStepUp', () => {
  it('sends once more after the code is accepted, and returns that answer', async () => {
    answerCheck(true);
    const answers = [refused(), Response.json({ ok: true })];
    let sent = 0;
    const r = await sendWithStepUp(async () => answers[sent++]!);
    expect(sent).toBe(2);
    expect(asked).toBe(1);
    expect(r.ok).toBe(true);
  });
  it('with the check closed, or no check mounted, returns the refusal and sends nothing more', async () => {
    for (const verified of [false, null]) {
      answerCheck(verified);
      let sent = 0;
      const r = await sendWithStepUp(async () => {
        sent += 1;
        return refused();
      });
      expect(sent).toBe(1);
      expect(await isStepUpResponse(r)).toBe(true);
    }
  });
  it('never asks for the code or sends again for any other answer', async () => {
    answerCheck(true);
    for (const answer of [
      () => Response.json({ error: 'Access denied' }, { status: 403 }),
      () => Response.json({ error: 'no' }, { status: 401 }),
      () => Response.json({ error: 'off' }, { status: 503 }),
      () => Response.json({ ok: true }),
    ]) {
      let sent = 0;
      await sendWithStepUp(async () => {
        sent += 1;
        return answer();
      });
      expect(sent).toBe(1);
    }
    expect(asked).toBe(0);
  });
  it('asks at most once: a second refusal after the code is returned as it is', async () => {
    answerCheck(true);
    let sent = 0;
    const r = await sendWithStepUp(async () => {
      sent += 1;
      return refused();
    });
    expect(sent).toBe(2);
    expect(asked).toBe(1);
    expect(r.status).toBe(401);
  });
});

describe('withStepUpSubmission', () => {
  const lapsed = () =>
    new SubmissionFailure(
      'Verify your authenticator again to continue',
      401,
      null,
      'STEP_UP_REQUIRED',
    );
  it('sends the same submission again after the code is accepted', async () => {
    answerCheck(true);
    let sent = 0;
    const result = await withStepUpSubmission(async () => {
      sent += 1;
      if (sent === 1) throw lapsed();
      return { id: 'saved' };
    });
    expect(result).toEqual({ id: 'saved' });
    expect(sent).toBe(2);
  });
  it('closed, fails with the kept-changes words as a definite rejection', async () => {
    answerCheck(false);
    let sent = 0;
    const error = await withStepUpSubmission(async () => {
      sent += 1;
      throw lapsed();
    }).catch((e: unknown) => e);
    expect(sent).toBe(1);
    expect(error).toBeInstanceOf(SubmissionFailure);
    expect((error as SubmissionFailure).message).toBe(stepUpKeptMessage);
    expect((error as SubmissionFailure).rejected).toBe(true);
  });
  it('passes every other failure through untouched', async () => {
    answerCheck(true);
    const other = new SubmissionFailure('Access denied', 403);
    await expect(
      withStepUpSubmission(async () => {
        throw other;
      }),
    ).rejects.toBe(other);
    await expect(
      withStepUpSubmission(async () => {
        throw new SubmissionFailure('Signed out', 401);
      }),
    ).rejects.toThrow('Signed out');
    expect(asked).toBe(0);
  });
});

// The screens the PR 658 audit and staff-admin-24 listed as ending on a dead end: each now sends through the recovery.
describe('the listed staff screens use the recovery', () => {
  const read = (path: string) => readFileSync(resolve('apps/web/app/operator', path), 'utf8');
  it('billing panels resend a refused save after the check', () => {
    for (const file of [
      'customer-billing.tsx',
      'customer-real-invoicing.tsx',
      'customer-invoicing.tsx',
      'customer-simulated-payments.tsx',
      'customer-service-requests.tsx',
    ]) {
      const code = read(file);
      expect(code, file).toMatch(
        /if \(r\?\.check && \(await requestStepUp\(\)\)\) r = await call\(/,
      );
      expect(code, file).toContain('setMessage(stepUpKeptMessage)');
    }
  });
  it('the review screens send every read and decision through sendWithStepUp', () => {
    for (const [file, sends] of [
      ['customer-service-catalogue.tsx', 1],
      ['company-link-review.tsx', 4],
      ['specification-requests.tsx', 2],
      ['decision-disclosures.tsx', 2],
      ['customer-mission-delivery.tsx', 2],
      ['delivery-experience.tsx', 1],
    ] as const) {
      const code = read(file);
      expect(code.match(/sendWithStepUp\(/g)?.length, file).toBe(sends);
      // No save goes out on its own any more.
      expect(code.match(/= await fetch\(endpoint,/g), file).toBeNull();
    }
    // The catalogue's own list read joins the billing group's one re-verify line (or draws its own when alone).
    const catalogue = read('customer-service-catalogue.tsx');
    expect(catalogue).toContain('if (await refusedForCheck(r)) {');
    expect(catalogue).toContain('<ReverifyLine');
  });
  it('Helpers sends its saves through withStepUpSubmission and passes the server code on', () => {
    const code = read('network.tsx');
    expect(code).toContain('withStepUpSubmission(() => submit(form, action, input, request))');
    expect(code).toContain("typeof body.code === 'string' ? body.code : undefined");
  });
});
