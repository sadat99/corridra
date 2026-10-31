// The browser address as an external store for `useSyncExternalStore`, so a link can follow it from
// the first render on: the server and the hydrating render both read '' and the real value arrives
// right after. It is told about `#` changes and history moves.
export function subscribeToHash(notify: () => void) {
  window.addEventListener('hashchange', notify);
  window.addEventListener('popstate', notify);
  return () => {
    window.removeEventListener('hashchange', notify);
    window.removeEventListener('popstate', notify);
  };
}
