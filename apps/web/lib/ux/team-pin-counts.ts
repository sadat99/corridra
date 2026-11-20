// The counts beside the two pinned queues in the team sidebar (operator desk). Today reads both queues; when a read
// succeeded it publishes the number here and the sidebar shows it. A queue whose read failed, was not asked or has not
// loaded has no entry, so no count is shown: never a zero that was not read. Today clears them when it closes, so a
// number is never kept after the page that read it is gone. Presentation only.

export type PinCounts = {
  problemReports: number | null;
  erasure: number | null;
  erasureAtLeast: boolean;
};

const empty: PinCounts = { problemReports: null, erasure: null, erasureAtLeast: false };
let current: PinCounts = empty;
const listeners = new Set<() => void>();

export function publishPinCounts(next: PinCounts) {
  if (
    next.problemReports === current.problemReports &&
    next.erasure === current.erasure &&
    next.erasureAtLeast === current.erasureAtLeast
  )
    return;
  current = next;
  listeners.forEach((listener) => listener());
}
export function clearPinCounts() {
  publishPinCounts(empty);
}
export function subscribePinCounts(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export const readPinCounts = () => current;
export const readServerPinCounts = () => empty;
