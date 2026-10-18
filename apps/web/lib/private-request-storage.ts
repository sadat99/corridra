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
