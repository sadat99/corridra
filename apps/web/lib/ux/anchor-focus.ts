// Reveal, then focus, for in-page anchors (home page v4.3). A link to a section that is collapsed or not drawn yet
// (a route block, a closed disclosure) must open it first and only then scroll and focus, so focus never lands on a
// heading that is absent. `revealThenFocus` tells the page which id was asked for; the page opens what hides it and
// calls `focusNow`. Client only: every function reads the browser.
export const anchorEvent = 'corridra:anchor';

type Doc = Pick<Document, 'getElementById'>;
type Frame = (callback: () => void) => unknown;

/** Announces that a person asked for the section with this id. The page listening for it reveals, then focuses. */
export function revealThenFocus(id: string, target: Pick<Window, 'dispatchEvent'> = window): void {
  target.dispatchEvent(new CustomEvent<{ id: string }>(anchorEvent, { detail: { id } }));
}

/** Runs `handler` for each requested id until the returned function is called. */
export function onAnchor(
  handler: (id: string) => void,
  target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
): () => void {
  const listener = (event: Event) => {
    const id = (event as CustomEvent<{ id?: string }>).detail?.id;
    if (id) handler(id);
  };
  target.addEventListener(anchorEvent, listener);
  return () => target.removeEventListener(anchorEvent, listener);
}

/** Opens every closed disclosure around an element, so it can be seen and focused. Returns whether any opened. */
export function openAncestors(element: Element | null): boolean {
  let opened = false;
  for (let node = element?.parentElement; node; node = node.parentElement) {
    if (node instanceof HTMLDetailsElement && !node.open) {
      node.open = true;
      opened = true;
    }
  }
  return opened;
}

/**
 * Scrolls to the element and moves focus to it, two animation frames from now (so a block opened a moment ago is
 * drawn). A target that is not focusable gets `tabindex="-1"` first. Returns false when the id is not on the page.
 */
export function focusNow(
  id: string,
  doc: Doc = document,
  frame: Frame = (callback) => requestAnimationFrame(callback),
): boolean {
  const element = doc.getElementById(id);
  if (!element) return false;
  frame(() =>
    frame(() => {
      if (!element.hasAttribute('tabindex')) element.setAttribute('tabindex', '-1');
      element.focus({ preventScroll: true });
      element.scrollIntoView({ block: 'start' });
    }),
  );
  return true;
}
