import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  applyStoredComfort,
  chooseContrast,
  chooseLessMovement,
  chooseTextSize,
  comfortBootScript,
  contrastAttribute,
  contrastStorageKey,
  currentContrast,
  currentLessMovement,
  currentNoteFilled,
  currentSaveFailed,
  currentSystemSetting,
  currentTextSize,
  handleComfortStorage,
  isComfortKey,
  lessMovementAttribute,
  lessMovementStorageKey,
  noteRefillDelayMs,
  parseContrast,
  parseLessMovement,
  parseTextSize,
  subscribeComfort,
  systemContrastQuery,
  systemReducedMotionQuery,
  textSizeAttribute,
  textSizeStorageKey,
  unsavedChoiceNote,
  watchComfortStorage,
} from '../../apps/web/lib/ux/comfort';
import { GET } from '../../apps/web/app/language-boot.js/route';

// W7, W10: Text Size, Stronger Colours and Less Movement are kept in this browser only and are in force before the first paint.

/** A tiny <html> and storage, so the choices can be exercised without a browser. */
function fakeBrowser(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
  const attributes = new Map<string, string>();
  const documentElement = {
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => void attributes.set(name, value),
    removeAttribute: (name: string) => void attributes.delete(name),
  };
  vi.stubGlobal('document', { documentElement });
  vi.stubGlobal('window', { localStorage: storage });
  return attributes;
}
const memoryStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
};
const blockedStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

afterEach(() => vi.unstubAllGlobals());

describe('parsing a saved choice', () => {
  test('only the known steps are taken; anything else is the default', () => {
    expect(parseTextSize('large')).toBe('large');
    expect(parseTextSize('largest')).toBe('largest');
    for (const bad of ['normal', 'huge', '', 'LARGE', '125', null, undefined, 3, {}])
      expect(parseTextSize(bad), String(bad)).toBe('normal');
    expect(parseLessMovement('on')).toBe('on');
    for (const bad of ['off', 'true', '1', 'ON', '', null, undefined, true])
      expect(parseLessMovement(bad), String(bad)).toBe('off');
    expect(parseContrast('more')).toBe('more');
    for (const bad of ['normal', 'on', 'true', 'MORE', '', null, undefined, 1, true])
      expect(parseContrast(bad), String(bad)).toBe('normal');
  });
});

describe('choosing in a browser that saves', () => {
  let storage: ReturnType<typeof memoryStorage>;
  let attributes: Map<string, string>;
  beforeEach(() => {
    storage = memoryStorage();
    attributes = fakeBrowser(storage);
  });

  test('a text size is put on the page, saved, and Normal clears both', () => {
    expect(chooseTextSize('large')).toBe(true);
    expect(attributes.get('data-text-size')).toBe('large');
    expect(storage.data.get(textSizeStorageKey)).toBe('large');
    expect(currentTextSize()).toBe('large');
    expect(chooseTextSize('largest')).toBe(true);
    expect(currentTextSize()).toBe('largest');
    expect(chooseTextSize('normal')).toBe(true);
    expect(attributes.has('data-text-size')).toBe(false);
    expect(storage.data.has(textSizeStorageKey)).toBe(false);
    expect(currentTextSize()).toBe('normal');
  });

  test('Less Movement is put on the page, saved, and Off clears both', () => {
    expect(chooseLessMovement('on')).toBe(true);
    expect(attributes.get('data-less-movement')).toBe('on');
    expect(storage.data.get(lessMovementStorageKey)).toBe('on');
    expect(currentLessMovement()).toBe('on');
    expect(chooseLessMovement('off')).toBe(true);
    expect(attributes.has('data-less-movement')).toBe(false);
    expect(storage.data.has(lessMovementStorageKey)).toBe(false);
  });

  test('Stronger Colours is put on the page, saved as more, and Off clears both', () => {
    expect(chooseContrast('more')).toBe(true);
    expect(attributes.get('data-contrast')).toBe('more');
    expect(storage.data.get(contrastStorageKey)).toBe('more');
    expect(currentContrast()).toBe('more');
    expect(chooseContrast('normal')).toBe(true);
    expect(attributes.has('data-contrast')).toBe(false);
    expect(storage.data.has(contrastStorageKey)).toBe(false);
    expect(currentContrast()).toBe('normal');
  });

  test('listeners hear a change and stop hearing once they unsubscribe', () => {
    const heard = vi.fn();
    const stop = subscribeComfort(heard);
    chooseTextSize('large');
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    chooseTextSize('normal');
    expect(heard).toHaveBeenCalledTimes(1);
  });

  test('applying what is saved sets the page, and a damaged saved value is the default', () => {
    storage.data.set(textSizeStorageKey, 'largest');
    storage.data.set(lessMovementStorageKey, 'on');
    storage.data.set(contrastStorageKey, 'more');
    applyStoredComfort();
    expect(currentTextSize()).toBe('largest');
    expect(currentLessMovement()).toBe('on');
    expect(currentContrast()).toBe('more');
    storage.data.set(textSizeStorageKey, 'enormous');
    storage.data.set(lessMovementStorageKey, 'sometimes');
    storage.data.set(contrastStorageKey, 'strong');
    applyStoredComfort();
    expect(currentTextSize()).toBe('normal');
    expect(currentLessMovement()).toBe('off');
    expect(currentContrast()).toBe('normal');
  });
});

describe('a browser that blocks its storage', () => {
  test('the choice still holds for this page, and the caller is told it was not saved', () => {
    const attributes = fakeBrowser(blockedStorage);
    expect(chooseTextSize('largest')).toBe(false);
    expect(attributes.get('data-text-size')).toBe('largest');
    expect(chooseLessMovement('on')).toBe(false);
    expect(attributes.get('data-less-movement')).toBe('on');
    expect(chooseContrast('more')).toBe(false);
    expect(attributes.get('data-contrast')).toBe('more');
    // The unsaved state is shared by the whole module, so leave it clean for the next case.
    fakeBrowser(memoryStorage());
    chooseTextSize('normal');
    chooseLessMovement('off');
    chooseContrast('normal');
    expect(currentSaveFailed()).toBe(false);
  });

  test('a refused Stronger Colours shows the note, and a save that works clears it', () => {
    fakeBrowser(blockedStorage);
    chooseContrast('more');
    expect(currentSaveFailed()).toBe(true);
    expect(currentNoteFilled()).toBe(true);
    fakeBrowser(memoryStorage());
    chooseContrast('normal');
    expect(currentSaveFailed()).toBe(false);
    expect(currentNoteFilled()).toBe(false);
  });

  test('the note says what is true: the choice lasts until the page loads again, by a reload, a link or a sign-in', () => {
    expect(unsavedChoiceNote).toBe(
      'This browser cannot save your choice. It lasts until the page loads again.',
    );
  });

  test('a save failed is false on load, set by either choice, and cleared only by a save of the same control', () => {
    fakeBrowser(memoryStorage());
    chooseTextSize('normal');
    chooseLessMovement('off');
    expect(currentSaveFailed()).toBe(false);
    // Loading with blocked storage is not a failed save: nothing is shown until a person chooses.
    fakeBrowser(blockedStorage);
    applyStoredComfort();
    expect(currentSaveFailed()).toBe(false);
    chooseLessMovement('on');
    expect(currentSaveFailed()).toBe(true);
    // Text Size saves fine, but Less Movement is still unsaved, so the note stays.
    const heard = vi.fn();
    const stop = subscribeComfort(heard);
    fakeBrowser(memoryStorage());
    chooseTextSize('large');
    expect(currentSaveFailed()).toBe(true);
    expect(currentNoteFilled()).toBe(true);
    expect(heard).toHaveBeenCalled();
    // A second control fails, then each save clears only its own control; the note goes with the last one.
    fakeBrowser(blockedStorage);
    chooseTextSize('largest');
    fakeBrowser(memoryStorage());
    chooseLessMovement('off');
    expect(currentSaveFailed()).toBe(true);
    chooseTextSize('normal');
    expect(currentSaveFailed()).toBe(false);
    expect(currentNoteFilled()).toBe(false);
    stop();
  });

  describe('announcing a repeated failure', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      fakeBrowser(memoryStorage());
      chooseTextSize('normal');
      chooseLessMovement('off');
    });
    afterEach(() => vi.useRealTimers());

    test('the first failure fills the note at once; a further failure empties it for a moment and fills it again', () => {
      fakeBrowser(blockedStorage);
      chooseTextSize('large');
      expect(currentNoteFilled()).toBe(true);
      chooseLessMovement('on');
      expect(currentNoteFilled()).toBe(false);
      vi.advanceTimersByTime(noteRefillDelayMs);
      expect(currentNoteFilled()).toBe(true);
    });

    test('a save that works while the note is emptied for the refill leaves it empty', () => {
      fakeBrowser(blockedStorage);
      chooseTextSize('large');
      chooseTextSize('largest');
      fakeBrowser(memoryStorage());
      chooseTextSize('normal');
      vi.advanceTimersByTime(noteRefillDelayMs);
      expect(currentSaveFailed()).toBe(false);
      expect(currentNoteFilled()).toBe(false);
    });
  });

  test('loading the page with blocked storage throws nothing and keeps what the page already shows', () => {
    const attributes = fakeBrowser(blockedStorage);
    chooseTextSize('large');
    expect(() => applyStoredComfort()).not.toThrow();
    expect(attributes.get('data-text-size')).toBe('large');
  });
});

describe('the script that runs before the first paint', () => {
  const run = (read: (key: string) => string | null) => {
    const attributes = new Map<string, string>();
    new Function('localStorage', 'document', comfortBootScript())(
      { getItem: read },
      {
        documentElement: {
          setAttribute: (name: string, value: string) => attributes.set(name, value),
        },
      },
    );
    return Object.fromEntries(attributes);
  };

  test('saved choices are on the page', () => {
    const saved: Record<string, string> = {
      [textSizeStorageKey]: 'largest',
      [lessMovementStorageKey]: 'on',
      [contrastStorageKey]: 'more',
    };
    expect(run((key) => saved[key] ?? null)).toEqual({
      'data-text-size': 'largest',
      'data-less-movement': 'on',
      'data-contrast': 'more',
    });
  });

  test('Stronger Colours is taken only when the saved value is exactly more', () => {
    expect(run((key) => (key === contrastStorageKey ? 'more' : null))).toEqual({
      'data-contrast': 'more',
    });
    for (const bad of ['normal', 'on', 'MORE', 'strong', ''])
      expect(
        run((key) => (key === contrastStorageKey ? bad : null)),
        bad,
      ).toEqual({});
  });

  test('nothing saved, an old value or a damaged value changes nothing', () => {
    expect(run(() => null)).toEqual({});
    expect(run(() => 'normal')).toEqual({});
    expect(run(() => 'enormous')).toEqual({});
  });

  test('blocked storage changes nothing and throws nothing', () => {
    expect(
      run(() => {
        throw new Error('blocked');
      }),
    ).toEqual({});
  });

  test('a missing document throws nothing', () => {
    expect(() =>
      new Function('localStorage', comfortBootScript())({ getItem: () => 'on' }),
    ).not.toThrow();
  });

  test('the script text names exactly the current storage keys and attribute names', () => {
    // It is written as one fixed literal, so renaming an exported constant without the script fails here.
    const script = comfortBootScript();
    expect(textSizeStorageKey).toBe('corridra.text-size');
    expect(lessMovementStorageKey).toBe('corridra.less-movement');
    expect(textSizeAttribute).toBe('data-text-size');
    expect(lessMovementAttribute).toBe('data-less-movement');
    expect(contrastStorageKey).toBe('corridra.contrast');
    expect(contrastAttribute).toBe('data-contrast');
    const names = [
      textSizeStorageKey,
      lessMovementStorageKey,
      contrastStorageKey,
      textSizeAttribute,
      lessMovementAttribute,
      contrastAttribute,
    ];
    for (const value of names) expect(script.split(`"${value}"`), value).toHaveLength(2);
    expect(Array.from(script.matchAll(/"([^"]*)"/g), (match) => match[1]).sort()).toEqual(
      [...names].sort(),
    );
  });

  test('the script holds only fixed text and can never close a tag', () => {
    const script = comfortBootScript();
    expect(script).not.toContain('</');
    expect(script).toContain(textSizeStorageKey);
    expect(script).toContain(lessMovementStorageKey);
    expect(script).toContain(contrastStorageKey);
    expect(script).not.toMatch(/fetch|XMLHttpRequest|sendBeacon|cookie/);
  });
});

describe('the boot file', () => {
  test('carries the language script and then the comfort script, with the same cache headers', async () => {
    const response = GET();
    const body = await response.text();
    expect(response.headers.get('Content-Type')).toBe('text/javascript; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(body).toContain('d.lang=v[0]');
    expect(body.endsWith(comfortBootScript())).toBe(true);
    expect(body.indexOf('d.lang=v[0]')).toBeLessThan(body.indexOf(textSizeStorageKey));
    expect(body.match(/\(function\(\)\{/g)).toHaveLength(2);
    expect(body).not.toContain('</');
  });
});

describe('the device settings', () => {
  const queryResult = (matches: boolean) => ({ matches });
  const device = (asks: Record<string, boolean>) =>
    vi.stubGlobal('window', {
      matchMedia: (query: string) => queryResult(asks[query] ?? false),
    });

  test('a device setting is read live, and each query is separate', () => {
    device({ [systemContrastQuery]: true });
    expect(currentSystemSetting(systemContrastQuery)).toBe(true);
    expect(currentSystemSetting(systemReducedMotionQuery)).toBe(false);
    device({ [systemReducedMotionQuery]: true });
    expect(currentSystemSetting(systemContrastQuery)).toBe(false);
    expect(currentSystemSetting(systemReducedMotionQuery)).toBe(true);
  });

  test('the queries are the standard media features', () => {
    expect(systemContrastQuery).toBe('(prefers-contrast: more)');
    expect(systemReducedMotionQuery).toBe('(prefers-reduced-motion: reduce)');
  });

  test('where the setting cannot be read it is not asked for', () => {
    vi.stubGlobal('window', {});
    expect(currentSystemSetting(systemContrastQuery)).toBe(false);
    vi.stubGlobal('window', {
      matchMedia: () => {
        throw new Error('blocked');
      },
    });
    expect(currentSystemSetting(systemContrastQuery)).toBe(false);
  });
});

describe('another tab changing a saved value', () => {
  /** A window that records the storage handler, over a browser whose storage works for reading but not writing. */
  function fakeWindow(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
    const attributes = fakeBrowser(storage);
    const handlers: Array<(event: { key: string | null }) => void> = [];
    vi.stubGlobal('window', {
      localStorage: storage,
      addEventListener: (type: string, handler: (event: { key: string | null }) => void) => {
        if (type === 'storage') handlers.push(handler);
      },
      removeEventListener: (type: string, handler: (event: { key: string | null }) => void) => {
        const at = handlers.indexOf(handler);
        if (type === 'storage' && at >= 0) handlers.splice(at, 1);
      },
    });
    return { attributes, handlers };
  }
  const readableOnly = (initial: Record<string, string> = {}) => ({
    ...memoryStorage(initial),
    setItem: () => {
      throw new Error('blocked');
    },
  });

  test('only the comfort keys, or a whole-storage clear, are ours', () => {
    for (const key of [textSizeStorageKey, lessMovementStorageKey, contrastStorageKey, null])
      expect(isComfortKey(key), String(key)).toBe(true);
    for (const key of ['unrelated', 'corridra.language', 'corridra.text-size.old', ''])
      expect(isComfortKey(key), key).toBe(false);
  });

  test('a change to an unrelated key leaves a choice this browser could not save alone', () => {
    // This is the bug the filter fixes: every storage event used to re-read the saved values, so an unrelated key
    // changing in another tab put the page back to Normal and undid a choice that only holds for this page.
    const { attributes, handlers } = fakeWindow(readableOnly());
    const stop = watchComfortStorage();
    expect(handlers).toHaveLength(1);
    expect(chooseTextSize('largest')).toBe(false);
    expect(attributes.get('data-text-size')).toBe('largest');
    handlers[0]({ key: 'unrelated' });
    expect(attributes.get('data-text-size')).toBe('largest');
    handlers[0]({ key: 'corridra.language' });
    expect(attributes.get('data-text-size')).toBe('largest');
    stop();
    expect(handlers).toHaveLength(0);
  });

  test('a change to a comfort key, or a clear of the whole storage, is taken from storage', () => {
    const { attributes, handlers } = fakeWindow(readableOnly({ [textSizeStorageKey]: 'large' }));
    watchComfortStorage();
    chooseTextSize('largest');
    handlers[0]({ key: textSizeStorageKey });
    expect(attributes.get('data-text-size')).toBe('large');
    chooseTextSize('largest');
    handlers[0]({ key: null });
    expect(attributes.get('data-text-size')).toBe('large');
  });

  test('a change to one comfort key puts back only that control, so an unsaved choice for another control stays', () => {
    // The old behaviour re-read all three keys on any comfort key, so a change to Stronger Colours in another tab put
    // Text Size back to Normal and undid a Text Size choice that this browser could not keep.
    const { attributes, handlers } = fakeWindow(readableOnly());
    watchComfortStorage();
    expect(chooseTextSize('largest')).toBe(false);
    expect(chooseLessMovement('on')).toBe(false);
    handlers[0]({ key: contrastStorageKey });
    expect(attributes.get('data-text-size')).toBe('largest');
    expect(attributes.get('data-less-movement')).toBe('on');
    handlers[0]({ key: lessMovementStorageKey });
    expect(attributes.has('data-less-movement')).toBe(false);
    expect(attributes.get('data-text-size')).toBe('largest');
    handlers[0]({ key: textSizeStorageKey });
    expect(attributes.has('data-text-size')).toBe(false);
  });

  test('a change to Stronger Colours in another tab is followed, and its removal is too', () => {
    const storage = memoryStorage();
    const { attributes } = fakeWindow(storage);
    storage.data.set(contrastStorageKey, 'more');
    handleComfortStorage({ key: contrastStorageKey });
    expect(attributes.get('data-contrast')).toBe('more');
    storage.data.delete(contrastStorageKey);
    handleComfortStorage({ key: contrastStorageKey });
    expect(attributes.has('data-contrast')).toBe(false);
  });
});
