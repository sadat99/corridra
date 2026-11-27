'use client';

import { useEffect, type Dispatch } from 'react';
import { flushSync } from 'react-dom';
import { anchorRoute, hashId } from '../lib/home-v43-data';
import type { HomeV43Event } from '../lib/home-v43-state';
import { focusNow, onAnchor, openAncestors } from '../lib/ux/anchor-focus';

// Home page v4.3: a link into the page (the header, the footer, a hash on load, an in-page action) opens what hides the
// target and only then scrolls and takes focus, so focus never lands on a heading that is not there. A target inside
// a route block opens that route first (the long block is closed until then); a target inside a closed disclosure
// opens the disclosure. Two animation frames later `focusNow` scrolls and focuses.
export function useAnchorReveal(dispatch: Dispatch<HomeV43Event>) {
  useEffect(() => {
    const go = (id: string) => {
      if (!id) return;
      const route = anchorRoute(id);
      // The route block must be in the page before the target is looked up. A hash on load and an event from outside
      // React arrive from a timer or a listener, where a plain dispatch is committed on a later task; a frame can come
      // first, find no target, and leave focus on the body. `flushSync` commits the block now.
      if (route) flushSync(() => dispatch({ type: 'openRoute', route }));
      openAncestors(document.getElementById(id));
      requestAnimationFrame(() => {
        openAncestors(document.getElementById(id));
        focusNow(id);
      });
    };
    const fromHash = () => go(hashId(window.location.hash));
    const stop = onAnchor(go);
    window.addEventListener('hashchange', fromHash);
    // The page was opened on an anchor: reveal it once the first paint is done.
    const first = window.setTimeout(fromHash, 0);
    return () => {
      stop();
      window.removeEventListener('hashchange', fromHash);
      window.clearTimeout(first);
    };
  }, [dispatch]);
}
