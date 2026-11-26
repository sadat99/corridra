'use client';

import { useEffect, type Dispatch } from 'react';
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
      if (route) dispatch({ type: 'openRoute', route });
      openAncestors(document.getElementById(id));
      // The route block is drawn on the next commit; look the target up after it.
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
