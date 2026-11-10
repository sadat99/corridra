import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  applyStoredComfort,
  chooseLessMovement,
  chooseTextSize,
  comfortBootScript,
  currentLessMovement,
  currentSaveFailed,
  currentTextSize,
  lessMovementAttribute,
  lessMovementStorageKey,
  parseLessMovement,
  parseTextSize,
  subscribeComfort,
  textSizeAttribute,
  textSizeStorageKey,
} from '../../apps/web/lib/ux/comfort';
import { GET } from '../../apps/web/app/language-boot.js/route';

// W7: Text Size and Less Movement are kept in this browser only and are in force before the first paint.

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
    applyStoredComfort();
    expect(currentTextSize()).toBe('largest');
    expect(currentLessMovement()).toBe('on');
    storage.data.set(textSizeStorageKey, 'enormous');
    storage.data.set(lessMovementStorageKey, 'sometimes');
    applyStoredComfort();
    expect(currentTextSize()).toBe('normal');
    expect(currentLessMovement()).toBe('off');
  });
});

describe('a browser that blocks its storage', () => {
  test('the choice still holds for this page, and the caller is told it was not saved', () => {
    const attributes = fakeBrowser(blockedStorage);
    expect(chooseTextSize('largest')).toBe(false);
    expect(attributes.get('data-text-size')).toBe('largest');
    expect(chooseLessMovement('on')).toBe(false);
    expect(attributes.get('data-less-movement')).toBe('on');
  });

  test('one shared flag says a save failed: false on load, set by either choice, cleared by a save that works', () => {
    fakeBrowser(memoryStorage());
    chooseTextSize('normal');
    expect(currentSaveFailed()).toBe(false);
    // Loading with blocked storage is not a failed save: nothing is shown until a person chooses.
    fakeBrowser(blockedStorage);
    applyStoredComfort();
    expect(currentSaveFailed()).toBe(false);
    chooseTextSize('large');
    expect(currentSaveFailed()).toBe(true);
    chooseLessMovement('on');
    expect(currentSaveFailed()).toBe(true);
    const heard = vi.fn();
    const stop = subscribeComfort(heard);
    fakeBrowser(memoryStorage());
    chooseLessMovement('off');
    expect(currentSaveFailed()).toBe(false);
    expect(heard).toHaveBeenCalled();
    stop();
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
    };
    expect(run((key) => saved[key] ?? null)).toEqual({
      'data-text-size': 'largest',
      'data-less-movement': 'on',
    });
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
    for (const value of [
      textSizeStorageKey,
      lessMovementStorageKey,
      textSizeAttribute,
      lessMovementAttribute,
    ])
      expect(script.split(`"${value}"`), value).toHaveLength(2);
    expect(Array.from(script.matchAll(/"([^"]*)"/g), (match) => match[1]).sort()).toEqual(
      [textSizeStorageKey, lessMovementStorageKey, textSizeAttribute, lessMovementAttribute].sort(),
    );
  });

  test('the script holds only fixed text and can never close a tag', () => {
    const script = comfortBootScript();
    expect(script).not.toContain('</');
    expect(script).toContain(textSizeStorageKey);
    expect(script).toContain(lessMovementStorageKey);
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
