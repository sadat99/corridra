export type PrivateRequestScope = { issuer: string; subject: string; workspaceId: string };
export const privateRequestStoragePrefix = 'corridra:private-request:v1:';
export function privateRequestStorageKeys(scope: PrivateRequestScope) {
  const key =
    privateRequestStoragePrefix +
    encodeURIComponent(JSON.stringify([scope.issuer, scope.subject, scope.workspaceId]));
  return { pending: key + ':pending', draft: key + ':draft' };
}

// Called only after the existing provider confirms customer logout. Other
// private capabilities and public receipt/draft keys are independent.
export function clearPrivateRequestStorage(storage: Storage) {
  const keys: string[] = [];
  for (let n = 0; n < storage.length; n++) {
    const key = storage.key(n);
    if (key?.startsWith(privateRequestStoragePrefix)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
  return keys.length;
}

// A request this tab has just sent from the request page (CQ-58). Only the request id and the time are kept,
// under the private prefix so sign-out clears it. The account request page can read it once, for its own id, to
// say "Request sent" with what happens next. It never grants access: the page still checks who is signed in.
const sentRequestKey = privateRequestStoragePrefix + 'sent';
const sentRequestWindow = 10 * 60 * 1000;
export function rememberSentRequest(storage: Storage, requestId: string, now = Date.now()) {
  storage.setItem(sentRequestKey, JSON.stringify({ requestId, at: now }));
}
/** True once for the request just sent from this tab, within ten minutes; the record is removed either way. */
export function takeSentRequest(storage: Storage, requestId: string, now = Date.now()) {
  const raw = storage.getItem(sentRequestKey);
  if (raw === null) return false;
  storage.removeItem(sentRequestKey);
  try {
    const value = JSON.parse(raw) as { requestId?: unknown; at?: unknown };
    return (
      value.requestId === requestId &&
      typeof value.at === 'number' &&
      now - value.at >= 0 &&
      now - value.at < sentRequestWindow
    );
  } catch {
    return false;
  }
}
