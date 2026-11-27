import { sendWithStepUp } from '../../lib/ux/step-up';
import {
  factsOutcome,
  routePackFactsAction,
  type FactsOutcome,
  type FactsSaveBody,
  type FactsSaved,
} from '../../lib/route-pack-editor-write';

// ADR-093 Phase 3, PR 2b: the one POST of the editor, route-pack-facts. It runs inside sendWithStepUp, so a 401 STEP_UP_REQUIRED
// opens the authenticator check in place and the same body (the same command id) is sent once more after the code is accepted.
// The refused send wrote nothing (the check is made before any change), so sending it again cannot save twice. A check that is
// closed without a code comes back as `stepUp`, and the page keeps its dialog, its reason and every edit.
export type SendResult =
  | { outcome: 'saved'; saved: FactsSaved }
  | {
      outcome: Exclude<FactsOutcome, 'saved'>;
      /** The server's own words of a refusal, when it sent any. */
      error: string | null;
    };
export async function sendFacts(tenant: string, body: FactsSaveBody): Promise<SendResult> {
  try {
    const response = await sendWithStepUp(() =>
      fetch(`/api/team-control/${routePackFactsAction}?${new URLSearchParams({ tenant })}`, {
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
    const outcome = factsOutcome(response.status, code);
    if (outcome !== 'saved') return { outcome, error };
    // A save with an answer this page cannot read is not claimed as saved.
    if (typeof record.version !== 'number' || !Number.isInteger(record.version))
      return { outcome: 'offline', error: null };
    return {
      outcome,
      saved: {
        version: record.version,
        duplicate: record.duplicate === true,
        warnings: Array.isArray(record.warnings) ? (record.warnings as FactsSaved['warnings']) : [],
      },
    };
  } catch {
    return { outcome: 'offline', error: null };
  }
}
