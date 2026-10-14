// A rejected startup must not poison a warm server for every later request.
// The caller still awaits ready, so failed security checks never grant access.
export function recoverableResource<T extends { ready: Promise<unknown> }>(create: () => T | null) {
  let current: T | null | undefined;
  return () => {
    if (current !== undefined) return current;
    const resource = create();
    current = resource;
    if (resource)
      void resource.ready.catch(() => {
        if (current === resource) current = undefined;
      });
    return resource;
  };
}
