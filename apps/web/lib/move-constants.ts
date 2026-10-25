/** Each read asks the provider for the session, so the per-workspace reads are bounded. */
export const moveWorkspaceCap = 8;

/** Pages followed per list. A list longer than this is reported as not read in full. */
export const movePageCap = 5;
