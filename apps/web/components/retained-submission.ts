'use client';
import { useRef } from 'react';
import { STEP_UP_REQUIRED, requestStepUp, stepUpKeptMessage } from '../lib/ux/step-up';

/** A response which definitively rejected a write may be corrected and submitted again. */
export class SubmissionFailure extends Error {
  unconfirmed = false;
  intentNotRecorded = false;
  constructor(
    message: string,
    readonly status: number,
    requestId?: string | null,
    /** The server's code, when it sent one (STEP_UP_REQUIRED for a lapsed authenticator check). */
    readonly code?: string,
  ) {
    super(
      message +
        (requestId &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)
          ? ` Reference: ${requestId}`
          : ''),
    );
  }
  get rejected() {
    return this.status >= 400 && this.status < 500 && ![408, 429].includes(this.status);
  }
}
export function submissionMessage(error: unknown, fallback: string, intentMayExist = false) {
  const message = error instanceof Error ? error.message : fallback;
  return error instanceof SubmissionFailure &&
    error.rejected &&
    !error.unconfirmed &&
    (!intentMayExist || error.intentNotRecorded)
    ? message
    : message +
        ' Receipt not confirmed. Retry this form to resend its original entries and reference.';
}

/**
 * Runs one retained submission under the in-place authenticator check, as withStepUp does: refused only because the
 * check lapsed (401 STEP_UP_REQUIRED, which is decided before anything is written), it opens the check and sends the
 * same command once more after the code is accepted. Closed, it fails with a message that says the entries are kept.
 */
export async function withStepUpSubmission<T>(send: () => Promise<T>): Promise<T> {
  try {
    return await send();
  } catch (error) {
    if (!(
      error instanceof SubmissionFailure &&
      error.status === 401 &&
      error.code === STEP_UP_REQUIRED
    ))
      throw error;
    if (!(await requestStepUp())) throw new SubmissionFailure(stepUpKeptMessage, 401);
    return send();
  }
}

/** Keep each mounted form's original command until its actual receipt or definitive rejection. */
export function useRetainedSubmission() {
  const pending = useRef(
    new WeakMap<HTMLFormElement, { action: string; input: unknown; uncertain: boolean }>(),
  );
  async function submit<T>(
    form: HTMLFormElement,
    action: string,
    input: unknown,
    request: (action: string, input: unknown) => Promise<T>,
  ) {
    const command = pending.current.get(form) ?? {
      action,
      input: structuredClone(input),
      uncertain: false,
    };
    pending.current.set(form, command);
    try {
      const receipt = await request(command.action, command.input);
      pending.current.delete(form);
      return receipt;
    } catch (error) {
      // AI run intent commits before grounding/provider work. Even a policy rejection can
      // leave a recorded run, so reconcile it with the same command before starting another.
      if (
        !command.uncertain &&
        error instanceof SubmissionFailure &&
        error.rejected &&
        (command.action !== 'ai-run' || error.intentNotRecorded)
      )
        pending.current.delete(form);
      else {
        command.uncertain = true;
        if (error instanceof SubmissionFailure) error.unconfirmed = true;
      }
      throw error;
    }
  }
  return submit;
}
