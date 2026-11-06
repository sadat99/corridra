import { describe, expect, it } from 'vitest';
import { onDeviceClock } from '../../apps/web/lib/server-clock';

// Owner report, 6 Nov 2026: the company profile and company link panels both said "could not be loaded" on a real
// device. Their views expire 60 seconds after the server answers, and the pages checked that expiry against the
// device clock with only a 5-second margin, so a device clock a few seconds off refused every valid answer.
const response = (date?: string) => new Response('{}', { headers: date ? { date } : {} });
const server = Date.parse('2026-11-06T12:00:00Z');
const view = { workspaceId: 'w', expiresAt: new Date(server + 60_000).toISOString() };

describe('server expiry on the device clock', () => {
  it('keeps the 60 seconds the server gave when the device clock runs behind', () => {
    const device = server - 90_000; // ninety seconds slow
    const shifted = onDeviceClock(view, response(new Date(server).toUTCString()), device);
    expect(Date.parse(shifted.expiresAt) - device).toBe(60_000);
    expect(shifted.workspaceId).toBe('w');
  });
  it('keeps the 60 seconds the server gave when the device clock runs ahead', () => {
    const device = server + 120_000; // two minutes fast
    const shifted = onDeviceClock(view, response(new Date(server).toUTCString()), device);
    expect(Date.parse(shifted.expiresAt) - device).toBe(60_000);
  });
  it('leaves the answer unchanged without a usable Date header or expiry', () => {
    expect(onDeviceClock(view, response())).toBe(view);
    expect(onDeviceClock(view, response('not a date'))).toBe(view);
    const other = { workspaceId: 'w' };
    expect(onDeviceClock(other, response(new Date(server).toUTCString()))).toBe(other);
    expect(onDeviceClock(null, response(new Date(server).toUTCString()))).toBe(null);
  });
});
