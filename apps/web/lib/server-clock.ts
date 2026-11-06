/**
 * Moves a server expiry onto this device's clock. Private views carry `expiresAt`, written with the server's clock;
 * a device whose clock runs a few seconds or minutes off would otherwise refuse a valid answer (or keep one too long).
 * The response's own `Date` header is the server's time at answering, so the expiry is shifted by the difference
 * between that time and this device's time. Without a usable `Date` header the value is returned unchanged.
 */
export function onDeviceClock<T>(value: T, response: Response, now: number = Date.now()): T {
  const server = Date.parse(response.headers.get('date') ?? '');
  if (!Number.isFinite(server) || !value || typeof value !== 'object') return value;
  const record = value as { expiresAt?: unknown };
  if (typeof record.expiresAt !== 'string') return value;
  const expires = Date.parse(record.expiresAt);
  if (!Number.isFinite(expires)) return value;
  // The Date header has one-second precision, so the shift can be up to a second late: harmless for a 60-second view.
  return { ...value, expiresAt: new Date(expires + (now - server)).toISOString() };
}
