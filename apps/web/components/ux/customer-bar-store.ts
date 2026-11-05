// A client-only holder for the one quiet line the customer header shows in its account menu: the privacy
// line on the live service, or the made-up-details line on the preview. The customer page (a server
// component) cannot hand it to the header directly, so it registers it here from a small client component.
// It holds one short line of words: no identity, role, tenant or token.
let note = '';
const listeners = new Set<() => void>();

export function setCustomerNote(next: string) {
  if (next === note) return;
  note = next;
  for (const listener of listeners) listener();
}
export function readCustomerNote() {
  return note;
}
/** The server always sees no line, so the first render is the same on the server and in the browser. */
export function readServerCustomerNote() {
  return '';
}
export function subscribeCustomerNote(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
