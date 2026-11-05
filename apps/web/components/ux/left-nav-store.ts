// The client-only state of the left navigation (layout budget, docs/revamp/specs/layout-budget.md
// section 1): is a left bar on this page, and is its drawer open. It holds a menu label and an
// element id, nothing about who is signed in, so no session or auth code reads or writes it. The
// header reads it to show the menu button only where a left bar exists; a page with none (a public
// page, a signed-out page) renders the header exactly as before. Owner: S4.

export type LeftNavState = {
  /** A left bar is mounted on this page. */
  present: boolean;
  /** The drawer is open (it only ever shows below 1024 px). */
  open: boolean;
  /** The id of the navigation the menu button controls. */
  controls: string;
  /** The words on the menu button. */
  label: string;
};

const empty: LeftNavState = { present: false, open: false, controls: '', label: '' };
let state: LeftNavState = empty;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function subscribeLeftNav(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export const readLeftNav = () => state;
export const readServerLeftNav = () => empty;

/** A left bar mounts: the menu button appears. The returned function removes it again. */
export function registerLeftNav(controls: string, label: string) {
  state = { ...state, present: true, controls, label };
  emit();
  return () => {
    state = empty;
    emit();
  };
}

export function setLeftNavOpen(open: boolean) {
  if (state.open === open) return;
  state = { ...state, open };
  emit();
}
