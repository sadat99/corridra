'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  emptyStage,
  parseStage,
  serialiseStage,
  stageCount,
  type Stage,
} from '../../lib/route-pack-editor-stage';
import type { FactDraft, Refusal } from '../../lib/route-pack-editor-fact-form';

// ADR-093 Phase 3, PR 2b: the unsaved edits of one route, held above the route view so they survive a change of view or
// section, and mirrored to sessionStorage as a convenience only. Everything touching the storage is in try/catch: the editor
// works the same without it. The mirror holds the edits and the version they were made on, never the reason, and the key is
// removed when nothing is staged. Nothing here runs unless the editor is drawn, so with the switch off no key is ever written.
// Follow-up per G73: the key carries the list's stageScope (an opaque key of the signed-in person), so another person in the
// same tab never gets the edits back; with no scope there is no copy. A copy under the earlier key without a person is removed,
// never restored.
export const mirrorKey = (tenant: string, scope: string, routeId: string) =>
  `corridra:route-pack-stage:v2:${tenant}:${scope}:${routeId}`;
const legacyMirrorKey = (tenant: string, routeId: string) =>
  `corridra:route-pack-stage:${tenant}:${routeId}`;
function readMirror(key: string): Stage | null {
  try {
    const stage = parseStage(window.sessionStorage.getItem(key));
    return stage && stageCount(stage) > 0 ? stage : null;
  } catch {
    return null;
  }
}
/** Whether a copy of the edits is in the tab's storage now (so "Your changes are kept for this tab session" is true). */
export const isMirrored = (tenant: string, scope: string | null, routeId: string) =>
  scope !== null && readMirror(mirrorKey(tenant, scope, routeId)) !== null;
export function clearMirror(tenant: string, scope: string | null, routeId: string) {
  if (scope === null) return;
  try {
    window.sessionStorage.removeItem(mirrorKey(tenant, scope, routeId));
  } catch {
    // The page works without the copy.
  }
}
/**
 * Whether the tab's copy is still the stage that was sent. A save can land after the person left the route and came back to
 * it, by when the copy holds newer edits; the save clears only a copy of what it sent.
 */
export function mirrorMatches(tenant: string, scope: string | null, routeId: string, sent: Stage) {
  if (scope === null) return false;
  try {
    return (
      window.sessionStorage.getItem(mirrorKey(tenant, scope, routeId)) === serialiseStage(sent)
    );
  } catch {
    return false;
  }
}

/** The one row that is open for editing: its draft, the step, what the last "Next" or "Keep Change" refused. */
export type OpenRow = {
  key: string;
  initial: FactDraft;
  draft: FactDraft;
  step: 1 | 2;
  /** The refusals shown now, from the last press of Next or Keep Change (and, live, from the typing). */
  shown: Refusal[];
  /** Raised each time refusals are shown, so focus goes to the first invalid control once. */
  focus: number;
};
export const isTouched = (open: OpenRow | null) =>
  !!open && JSON.stringify(open.draft) !== JSON.stringify(open.initial);

export type RouteSession = {
  /** The stage as the page uses it: an empty stage follows the saved version, so a new edit is made on what is saved now. */
  stage: Stage;
  setStage: (change: (stage: Stage) => Stage) => void;
  open: OpenRow | null;
  setOpen: (next: OpenRow | null | ((open: OpenRow | null) => OpenRow | null)) => void;
  /** How many edits came back from the tab's storage on this visit; 0 once the person changes anything. */
  restored: number;
};
/**
 * The session of one route (the editor is mounted once per route). The stage is restored from the tab's storage when the
 * session starts, and written back whenever it changes once the route is read (`savedVersion` is not null).
 */
export function useRouteSession(
  tenant: string,
  /** The list's stageScope; null (not read) means no copy is read or written. */
  scope: string | null,
  routeId: string,
  savedVersion: number | null,
  /** Only the owner edits: for anyone else nothing is read from or written to the tab's storage. */
  owner: boolean,
): RouteSession {
  const key = owner && scope !== null ? mirrorKey(tenant, scope, routeId) : null;
  const [raw, setRaw] = useState<{ stage: Stage; restored: number }>(() => {
    const stage = typeof window === 'undefined' || key === null ? null : readMirror(key);
    return stage ? { stage, restored: stageCount(stage) } : { stage: emptyStage(0), restored: 0 };
  });
  const [open, setOpen] = useState<OpenRow | null>(null);
  // An empty stage stands on the newest version known: the one read, or the one a save just made (the page sets an empty stage
  // on it), which the read of the route may not show yet. A new edit is then never made on the version before the save.
  const follow = (current: Stage) =>
    stageCount(current) === 0 && savedVersion !== null
      ? emptyStage(Math.max(savedVersion, current.baseVersion))
      : current;
  const stage = follow(raw.stage);
  const setStage = useCallback(
    (change: (stage: Stage) => Stage) =>
      setRaw((current) => {
        const from =
          stageCount(current.stage) === 0 && savedVersion !== null
            ? emptyStage(Math.max(savedVersion, current.stage.baseVersion))
            : current.stage;
        return { stage: change(from), restored: 0 };
      }),
    [savedVersion],
  );
  // A copy under the earlier key, which named no person, is removed when the route is drawn and never restored.
  useEffect(() => {
    try {
      window.sessionStorage.removeItem(legacyMirrorKey(tenant, routeId));
    } catch {
      // The page works without the copy.
    }
  }, [tenant, routeId]);
  // The copy: written once the route is read, removed when nothing is staged.
  const text = stageCount(stage) > 0 ? serialiseStage(stage) : null;
  useEffect(() => {
    if (key === null || savedVersion === null) return;
    try {
      if (text) window.sessionStorage.setItem(key, text);
      else window.sessionStorage.removeItem(key);
    } catch {
      // The page works without the copy.
    }
  }, [key, savedVersion, text]);
  // The browser asks before the tab closes only while something is staged.
  const staged = text !== null;
  useEffect(() => {
    if (!staged) return;
    const ask = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', ask);
    return () => window.removeEventListener('beforeunload', ask);
  }, [staged]);
  return { stage, setStage, open, setOpen, restored: raw.restored };
}
