// Focus rules for the form kit (commercial readiness program, 5.2 and CQ-01). Owner: WS-E.
// Pure functions so the rule is tested without a browser.

/**
 * The error summary takes focus once for each submit attempt and only when it has errors to show.
 * Typing changes the error list but never the attempt number, so typing never moves focus (CQ-01).
 * `lastFocused` is the attempt the summary last took focus for.
 */
export function summaryFocusDue(attempt: number, lastFocused: number, errorCount: number): boolean {
  return attempt > 0 && attempt !== lastFocused && errorCount > 0;
}

/** The field id an error links to: a plain HTML id, never a selector or an address. */
export function fieldAnchor(field: string): string {
  return field.replace(/[^A-Za-z0-9_:.-]/g, '-');
}
