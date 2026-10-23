import { describe, expect, it } from 'vitest';
import {
  forgetReceipt,
  readReceipt,
  receiptDeviceMs,
  receiptKey,
  receiptSavedAtKey,
  saveReceipt,
  type ReceiptStores,
} from '../../apps/web/lib/receipt-memory';

const code = 'a'.repeat(64);
const other = 'b'.repeat(64);
const now = Date.parse('2026-10-23T12:00:00.000Z');

function memory(fail: 'none' | 'write' | 'read' | 'all' = 'none') {
  const data = new Map<string, string>();
  return {
    data,
    getItem(key: string) {
      if (fail === 'read' || fail === 'all') throw new Error('blocked');
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (fail === 'write' || fail === 'all') throw new Error('full');
      data.set(key, value);
    },
    removeItem(key: string) {
      if (fail === 'all') throw new Error('blocked');
      data.delete(key);
    },
  };
}
const stores = (local = memory(), session = memory()) =>
  ({ local, session }) satisfies ReceiptStores;

describe('remembering a receipt on this device', () => {
  it('keeps a new receipt on the device and takes the old tab copy away', () => {
    const s = stores();
    s.session.data.set(receiptKey, other);
    expect(saveReceipt(s, code, now)).toBe('device');
    expect(s.local.data.get(receiptKey)).toBe(code);
    expect(s.local.data.get(receiptSavedAtKey)).toBe(String(now));
    expect(s.session.data.has(receiptKey)).toBe(false);
  });
  it('is found again by a later visit with a fresh tab', () => {
    const s = stores();
    saveReceipt(s, code, now);
    const later = stores(s.local, memory());
    expect(readReceipt(later, now + 3 * 24 * 60 * 60 * 1000)).toEqual({
      receipt: code,
      place: 'device',
    });
  });
  it('forgets a receipt older than thirty days, as the server does', () => {
    const s = stores();
    saveReceipt(s, code, now);
    expect(readReceipt(s, now + receiptDeviceMs)).toEqual({ receipt: code, place: 'device' });
    expect(readReceipt(s, now + receiptDeviceMs + 1)).toBeNull();
    expect(s.local.data.size).toBe(0);
  });
  it('ignores and removes a value that is not a receipt code', () => {
    for (const bad of ['', 'short', 'g'.repeat(64), 'A'.repeat(64), code + 'a', '<script>']) {
      const s = stores();
      s.local.data.set(receiptKey, bad);
      s.session.data.set(receiptKey, bad);
      expect(readReceipt(s, now)).toBeNull();
    }
    expect(saveReceipt(stores(), 'not a code', now)).toBe('none');
  });
  it('moves a code found only in the tab onto the device when it can', () => {
    const s = stores();
    s.session.data.set(receiptKey, code);
    expect(readReceipt(s, now)).toEqual({ receipt: code, place: 'device' });
    expect(s.local.data.get(receiptKey)).toBe(code);
  });
  it('falls back to the tab when the device refuses, and says so', () => {
    const s = stores(memory('write'), memory());
    expect(saveReceipt(s, code, now)).toBe('tab');
    expect(s.session.data.get(receiptKey)).toBe(code);
    expect(readReceipt(s, now)).toEqual({ receipt: code, place: 'tab' });
  });
  it('reports that nothing was stored when no storage works, and never throws', () => {
    const s = stores(memory('all'), memory('all'));
    expect(saveReceipt(s, code, now)).toBe('none');
    expect(readReceipt(s, now)).toBeNull();
    expect(() => forgetReceipt(s)).not.toThrow();
    const none: ReceiptStores = { local: null, session: null };
    expect(saveReceipt(none, code, now)).toBe('none');
    expect(readReceipt(none, now)).toBeNull();
    expect(() => forgetReceipt(none)).not.toThrow();
  });
  it('does not claim the device kept it when a write cannot be read back', () => {
    const local = memory();
    const original = local.setItem.bind(local);
    local.setItem = (key: string, value: string) => {
      if (key === receiptKey) return; // silently dropped
      original(key, value);
    };
    expect(saveReceipt(stores(local, memory('all')), code, now)).toBe('none');
  });
  it('forgets on the device and in the tab, and leaves other keys alone', () => {
    const s = stores();
    saveReceipt(s, code, now);
    s.session.data.set(receiptKey, code);
    s.local.data.set('other-key', 'keep');
    forgetReceipt(s);
    expect(s.local.data.has(receiptKey)).toBe(false);
    expect(s.local.data.has(receiptSavedAtKey)).toBe(false);
    expect(s.session.data.has(receiptKey)).toBe(false);
    expect(s.local.data.get('other-key')).toBe('keep');
    expect(readReceipt(s, now)).toBeNull();
  });
  it('uses the same storage key as before, so an old tab copy still restores', () => {
    expect(receiptKey).toBe('corridra-mission-receipt');
  });
});
