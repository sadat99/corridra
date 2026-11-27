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
export const mirrorKey = (tenant: string, routeId: string) =>
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
export const isMirrored = (tenant: string, routeId: string) =>
  readMirror(mirrorKey(tenant, routeId)) !== null;
export function clearMirror(tenant: string, routeId: string) {
  try {
    window.sessionStorage.removeItem(mirrorKey(tenant, routeId));
  } catch {
    // The page works without the copy.
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
  routeId: string,
  savedVersion: number | null,
  /** Only the owner edits: for anyone else nothing is read from or written to the tab's storage. */
  enabled: boolean,
): RouteSession {
  const [raw, setRaw] = useState<{ stage: Stage; restored: number }>(() => {
    const stage =
      typeof window === 'undefined' || !enabled ? null : readMirror(mirrorKey(tenant, routeId));
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
  // The copy: written once the route is read, removed when nothing is staged.
  const text = stageCount(stage) > 0 ? serialiseStage(stage) : null;
  useEffect(() => {
    if (!enabled || savedVersion === null) return;
    try {
      const key = mirrorKey(tenant, routeId);
      if (text) window.sessionStorage.setItem(key, text);
      else window.sessionStorage.removeItem(key);
    } catch {
      // The page works without the copy.
    }
  }, [enabled, tenant, routeId, savedVersion, text]);
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
