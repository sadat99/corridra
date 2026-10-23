// Remembers the private receipt code of a sample request on this device, so a person can come back
// without copying it. Storage only: the server still keeps just a digest, and nothing here changes
// the receipt format or the receipt API. Every storage call can throw (blocked or full storage), so
// each one is guarded and the page keeps working without it.

export const receiptKey = 'corridra-mission-receipt';
export const receiptSavedAtKey = 'corridra-mission-receipt-at';
// A receipt stops working on the server after 30 days, so the device forgets it then too.
export const receiptDeviceMs = 30 * 24 * 60 * 60 * 1000;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type ReceiptStores = { local: Store | null; session: Store | null };
export type ReceiptPlace = 'device' | 'tab';

const shape = /^[a-f0-9]{64}$/;

function attempt<T>(action: () => T): T | undefined {
  try {
    return action();
  } catch {
    return undefined;
  }
}

/** The browser's own stores, or null where the browser refuses access. */
export function browserStores(): ReceiptStores {
  const store = (name: 'localStorage' | 'sessionStorage') =>
    attempt(() => (typeof window === 'undefined' ? null : window[name])) ?? null;
  return { local: store('localStorage'), session: store('sessionStorage') };
}

function forgetDevice(stores: ReceiptStores) {
  if (!stores.local) return;
  const local = stores.local;
  attempt(() => local.removeItem(receiptKey));
  attempt(() => local.removeItem(receiptSavedAtKey));
}

/** Writes to this device. True only when the write really happened and can be read back. */
function writeDevice(stores: ReceiptStores, receipt: string, now: number) {
  if (!stores.local) return false;
  const local = stores.local;
  const wrote = attempt(() => {
    local.setItem(receiptKey, receipt);
    local.setItem(receiptSavedAtKey, String(now));
    return local.getItem(receiptKey) === receipt;
  });
  if (!wrote) forgetDevice(stores);
  return wrote === true;
}

/**
 * Where the receipt is remembered. A code found only in the tab is moved to the device when the
 * device will take it. A value that is not a 64-character code, or is past 30 days, is dropped.
 */
export function readReceipt(
  stores: ReceiptStores,
  now = Date.now(),
): { receipt: string; place: ReceiptPlace } | null {
  if (stores.local) {
    const local = stores.local;
    const value = attempt(() => local.getItem(receiptKey));
    if (value) {
      const savedAt = Number(attempt(() => local.getItem(receiptSavedAtKey)) ?? 0);
      const fresh = !savedAt || (now - savedAt >= 0 && now - savedAt <= receiptDeviceMs);
      if (shape.test(value) && fresh) return { receipt: value, place: 'device' };
      forgetDevice(stores);
    }
  }
  if (stores.session) {
    const session = stores.session;
    const value = attempt(() => session.getItem(receiptKey));
    if (value && shape.test(value))
      return { receipt: value, place: writeDevice(stores, value, now) ? 'device' : 'tab' };
  }
  return null;
}

/** Remembers a new receipt. 'none' means nothing could be stored, so the person must copy it. */
export function saveReceipt(
  stores: ReceiptStores,
  receipt: string,
  now = Date.now(),
): ReceiptPlace | 'none' {
  if (!shape.test(receipt)) return 'none';
  if (writeDevice(stores, receipt, now)) {
    const session = stores.session;
    if (session) attempt(() => session.removeItem(receiptKey));
    return 'device';
  }
  if (stores.session) {
    const session = stores.session;
    const kept = attempt(() => {
      session.setItem(receiptKey, receipt);
      return session.getItem(receiptKey) === receipt;
    });
    if (kept) return 'tab';
  }
  return 'none';
}

/** Stops remembering on this device and in this tab. The receipt still works on the server. */
export function forgetReceipt(stores: ReceiptStores) {
  forgetDevice(stores);
  if (stores.session) {
    const session = stores.session;
    attempt(() => session.removeItem(receiptKey));
  }
}
