'use client';
import { useEffect, useState } from 'react';
import { checklistTermsFrom, type ChecklistTerms } from '../../../lib/programme-room';
import { parseState, termsApi } from './terms-client';

type Scope = { subject: string; issuer: string; workspaceId?: string; programmeId?: string };

/**
 * The checklist's terms, places and minimum, read from the same existing terms 'state' view and parser the
 * Terms panel uses (`termsApi`, `parseState`). It runs on its own, beside the programme projection, so the
 * Overview never waits for it. Any failure (no access, switch off, expired, malformed) leaves the facts as
 * null, which the checklist words as "Not measured yet", never as zero or "Not set".
 */
export function useChecklistTerms(
  scope: Scope,
  enabled: boolean,
  refreshKey: number,
): ChecklistTerms | null {
  const { subject, issuer, workspaceId, programmeId } = scope;
  const [terms, setTerms] = useState<ChecklistTerms | null>(null);
  useEffect(() => {
    if (!enabled || !workspaceId || !programmeId) return;
    const controller = new AbortController();
    termsApi(subject, issuer)
      .get({ view: 'state', workspaceId, programmeId }, controller.signal)
      .then((raw) => {
        if (controller.signal.aborted) return;
        setTerms(checklistTermsFrom(parseState(raw, workspaceId, programmeId)));
      })
      .catch(() => {
        if (!controller.signal.aborted) setTerms(null);
      });
    return () => controller.abort();
  }, [subject, issuer, workspaceId, programmeId, enabled, refreshKey]);
  return enabled ? terms : null;
}
