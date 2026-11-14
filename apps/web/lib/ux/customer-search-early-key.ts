// A Ctrl K pressed before the customer search dialog exists (docs/revamp/specs/navigation-v1/customer-search.md). The
// page's script is evaluated before React hydrates, and the dialog is drawn one render after that (it is a portal that
// waits for the browser), so on a slow first load the key can arrive where nothing listens. It is remembered here with
// the element that had focus, and the dialog opens as soon as it exists. A key older than the hold is dropped: a person
// who pressed it and gave up is not surprised later. The only state is that element and the time of the key: no words,
// no request, no storage, nothing the person typed.
import { isShortcut } from './customer-search-status';

const holdMs = 5000;
let held: { opener: HTMLElement | null; at: number } | null = null;

/** Keeps a request to open, with the element to give focus back to. Used by the early listener and the dialog. */
export function rememberOpen(opener: HTMLElement | null) {
  held = { opener, at: Date.now() };
}

/** The held request if it is still fresh, once: taking it clears it. */
export function takePendingOpen(): { opener: HTMLElement | null } | null {
  const taken = held;
  held = null;
  return taken && Date.now() - taken.at <= holdMs ? taken : null;
}

// The early listener exists only for the window before a dialog attaches its own: the first dialog to listen removes
// it, for good, so a page without the customer header, reached by a client-side move after the dialog is gone, keeps the
// browser's own Ctrl K and parks nothing. It keeps the dialog's own guard: another open modal keeps the key.
function onEarlyKey(event: KeyboardEvent) {
  if (!isShortcut(event)) return;
  if (document.querySelector('dialog[open]')) return;
  event.preventDefault();
  const active = document.activeElement;
  rememberOpen(active instanceof HTMLElement && active !== document.body ? active : null);
}

export function stopEarlyListener() {
  if (typeof window !== 'undefined') window.removeEventListener('keydown', onEarlyKey);
}

// Registered when this file is evaluated, which is before hydration.
if (typeof window !== 'undefined') window.addEventListener('keydown', onEarlyKey);
