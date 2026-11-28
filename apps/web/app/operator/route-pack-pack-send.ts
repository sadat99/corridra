import { sendWithStepUp } from '../../lib/ux/step-up';
import { routePackPublishAction, type PackChangeBody } from '../../lib/route-pack-editor-publish';
import type { PackPreview, PackPublished } from '../../lib/route-pack-editor-publish';
import {
  packOutcome,
  readPreview,
  readPublished,
  type PackOutcome,
} from '../../lib/route-pack-editor-pack';

// ADR-093 Phase 3, PR 3b: the one pack request of the editor, route-pack-publish, as a preview or a publish. config.manage needs
// a fresh authenticator for both, so every request runs inside sendWithStepUp: a 401 STEP_UP_REQUIRED opens the authenticator
// check in place and the same body (the same command id) is sent once more after the code is accepted. The refused send wrote
// nothing, so sending it again cannot publish twice. A check closed without a code comes back as `stepUp`, and the dialog
// keeps its step, its choices and its reason.
export type PackSendResult =
  | { outcome: 'previewed'; preview: PackPreview }
  | { outcome: 'published'; published: PackPublished }
  | {
      outcome: Exclude<PackOutcome, 'previewed' | 'published'>;
      /** The server's own words of a refusal, when it sent any. */
      error: string | null;
    };
export async function sendPack(
  tenant: string,
  body: PackChangeBody,
  onePersonPublication: boolean,
): Promise<PackSendResult> {
  try {
    const response = await sendWithStepUp(() =>
      fetch(`/api/team-control/${routePackPublishAction}?${new URLSearchParams({ tenant })}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    const record = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
    const code = typeof record.code === 'string' ? record.code : null;
    const error = typeof record.error === 'string' ? record.error : null;
    const outcome = packOutcome(body.mode, response.status, code, error, onePersonPublication);
    if (outcome === 'previewed') {
      const preview = readPreview(json);
      // A preview this page cannot read is not drawn as one.
      return preview ? { outcome, preview } : { outcome: 'offline', error: null };
    }
    if (outcome === 'published') {
      const published = readPublished(json);
      // A publish whose version this page cannot read is never claimed as published.
      return published ? { outcome, published } : { outcome: 'offline', error: null };
    }
    return { outcome, error };
  } catch {
    return { outcome: 'offline', error: null };
  }
}
