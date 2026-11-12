/** The one integer the server answers, or null for anything else: an unknown total is never shown as zero. */
export function parseSharedObjectiveCount(value: unknown): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  const count = (value as { count?: unknown }).count;
  return keys.length === 1 && Number.isSafeInteger(count) && (count as number) >= 0
    ? (count as number)
    : null;
}

export function sharedObjectiveCountLine(count: number): string {
  if (count === 0) return 'No delegate has shared an objective summary yet.';
  return count === 1
    ? '1 delegate has shared an objective summary with you.'
    : `${count} delegates have shared an objective summary with you.`;
}
