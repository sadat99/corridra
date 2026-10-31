// Client side of D12 (commercial readiness program, 5.2). A refused action answers HTTP 401 with
// { code: "STEP_UP_REQUIRED" }. withStepUp opens the in-place re-verify dialog, waits for the person to
// confirm their authenticator, then retries the action once. Any other failure is thrown so the caller
// shows it next to the action; nothing fails silently. Owner after Wave 0: WS-E (client), WS-D (server).

export const STEP_UP_REQUIRED = 'STEP_UP_REQUIRED';
export const stepUpEvent = 'corridra:step-up';

export type StepUpRequest = { resolve: (verified: boolean) => void };

/** A failure the UI must show. `code` is set when the server sent one. */
export class ActionError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

/** Reads a fetch Response and throws ActionError for anything that is not ok. */
export async function readJson<T = unknown>(response: Response): Promise<T> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const record = (body ?? {}) as { error?: unknown; code?: unknown };
    throw new ActionError(
      typeof record.error === 'string' ? record.error : 'The request could not be completed.',
      response.status,
      typeof record.code === 'string' ? record.code : undefined,
    );
  }
  return body as T;
}

export function isStepUpRequired(error: unknown): boolean {
  return error instanceof ActionError && error.status === 401 && error.code === STEP_UP_REQUIRED;
}

/** Asks the mounted StepUpDialog to re-verify. Resolves false when no dialog is mounted or it is closed. */
export function requestStepUp(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  return new Promise((resolve) => {
    const detail: StepUpRequest = { resolve };
    const handled = !window.dispatchEvent(
      new CustomEvent<StepUpRequest>(stepUpEvent, { detail, cancelable: true }),
    );
    if (!handled) resolve(false);
  });
}

/**
 * Runs an action. When it is refused with STEP_UP_REQUIRED, opens the dialog and retries once after a
 * successful re-verify. The action should throw ActionError (readJson does) for a refused response.
 */
export async function withStepUp<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (!isStepUpRequired(error)) throw error;
    const verified = await requestStepUp();
    if (!verified)
      throw new ActionError(
        'Confirm your authenticator code to finish this. Your changes are kept.',
        401,
        STEP_UP_REQUIRED,
      );
    return action();
  }
}
