import { describe, expect, test } from 'vitest';
import {
  forgetAllRecents,
  forgetDeviceRecents,
  forgetOtherRecents,
  forgetRecents,
  readRecents,
  recentsForRole,
  recentsKey,
  recentsLimit,
  recentsPrefix,
  rememberRecent,
  type RecentsStore,
} from '../../apps/web/lib/ux/palette-recents';

// The palette's recents (docs/revamp/specs/navigation-v1/command-palette-search.md, section 6): per device, per
// signed-in person and workspace, names only, never the query, cleared on sign-out.
class MemoryStore implements RecentsStore {
  data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  key(n: number) {
    return [...this.data.keys()][n] ?? null;
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}
const uuid = (n: number) => `0b5a0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const X = uuid(900);
const Y = uuid(901);
const item = (n: number, kind: 'mission' | 'company' = 'mission', label = `Name ${n}`) => ({
  kind,
  id: uuid(n),
  label,
});

describe('P7 recents', () => {
  test('most recent first, no repeats, at most eight', () => {
    const store = new MemoryStore();
    for (let n = 1; n <= 10; n++) rememberRecent(store, 'person-a', X, item(n));
    const list = readRecents(store, 'person-a', X);
    expect(list).toHaveLength(recentsLimit);
    expect(list[0]!.label).toBe('Name 10');
    expect(list.at(-1)!.label).toBe('Name 3');
    rememberRecent(store, 'person-a', X, item(5));
    const again = readRecents(store, 'person-a', X);
    expect(again[0]!.id).toBe(uuid(5));
    expect(again.filter((r) => r.id === uuid(5))).toHaveLength(1);
    expect(again).toHaveLength(8);
  });
  test('a mission and a company may share an id and stay two items', () => {
    const store = new MemoryStore();
    rememberRecent(store, 'a', X, item(1, 'mission'));
    rememberRecent(store, 'a', X, item(1, 'company'));
    expect(readRecents(store, 'a', X).map((r) => r.kind)).toEqual(['company', 'mission']);
  });
  test('the role filter keeps a recent only where the role may open its place', () => {
    const all = [item(1, 'mission'), item(2, 'company')];
    expect(recentsForRole(all, ['action:workspace-missions', 'action:workspace-research'])).toEqual(
      all,
    );
    expect(recentsForRole(all, ['action:workspace-missions'])).toEqual([all[0]]);
    expect(recentsForRole(all, ['action:workspace-research'])).toEqual([all[1]]);
    expect(recentsForRole(all, [])).toEqual([]);
  });
});

describe('D5 recents never cross people or workspaces', () => {
  test("person A's recents are absent for person B on the same device", () => {
    const store = new MemoryStore();
    rememberRecent(store, 'person-a', X, item(1));
    expect(readRecents(store, 'person-b', X)).toEqual([]);
    expect(readRecents(store, 'person-a', X)).toHaveLength(1);
  });
  test('workspace X and workspace Y are separate', () => {
    const store = new MemoryStore();
    rememberRecent(store, 'person-a', X, item(1));
    expect(readRecents(store, 'person-a', Y)).toEqual([]);
  });
  test('opening as person B removes person A’s lists from the device', () => {
    const store = new MemoryStore();
    rememberRecent(store, 'person-a', X, item(1));
    rememberRecent(store, 'person-a', Y, item(2));
    rememberRecent(store, 'person-b', X, item(3));
    expect(forgetOtherRecents(store, 'person-b')).toBe(2);
    expect(readRecents(store, 'person-a', X)).toEqual([]);
    expect(readRecents(store, 'person-b', X)).toHaveLength(1);
  });
  test('sign-out removes every list, and only the palette’s own keys', () => {
    const store = new MemoryStore();
    store.setItem('corridra-mission-receipt', 'keep');
    rememberRecent(store, 'person-a', X, item(1));
    rememberRecent(store, 'person-b', Y, item(2));
    expect(forgetAllRecents(store)).toBe(2);
    expect(store.getItem('corridra-mission-receipt')).toBe('keep');
    expect(store.length).toBe(1);
  });
  test('Clear Recents removes one person’s list in one workspace', () => {
    const store = new MemoryStore();
    rememberRecent(store, 'a', X, item(1));
    rememberRecent(store, 'a', Y, item(2));
    forgetRecents(store, 'a', X);
    expect(readRecents(store, 'a', X)).toEqual([]);
    expect(readRecents(store, 'a', Y)).toHaveLength(1);
  });
  test('only the kind, id and name are stored; no query, detail, time or role', () => {
    const store = new MemoryStore();
    rememberRecent(store, 'person-a', X, {
      ...item(1),
      detail: 'secret',
      query: 'mad',
      at: 1,
    } as never);
    const raw = JSON.parse(store.getItem(recentsKey('person-a', X))!) as {
      v: number;
      items: Record<string, unknown>[];
    };
    expect(Object.keys(raw).sort()).toEqual(['items', 'v']);
    expect(Object.keys(raw.items[0]!).sort()).toEqual(['id', 'k', 'l']);
    expect(store.getItem(recentsKey('person-a', X))).not.toMatch(/secret|mad"|"at"/);
    expect([...store.data.keys()][0]!.startsWith(recentsPrefix)).toBe(true);
  });
});

describe('what is read back is checked', () => {
  const put = (store: MemoryStore, value: string) => store.setItem(recentsKey('a', X), value);
  test('corrupt or oversized values are removed and read as nothing', () => {
    const store = new MemoryStore();
    put(store, '{not json');
    expect(readRecents(store, 'a', X)).toEqual([]);
    expect(store.length).toBe(0);
    put(store, JSON.stringify({ v: 1, items: [], pad: 'x'.repeat(5000) }));
    expect(readRecents(store, 'a', X)).toEqual([]);
    expect(store.length).toBe(0);
    put(store, JSON.stringify({ v: 2, items: [] }));
    expect(readRecents(store, 'a', X)).toEqual([]);
  });
  test('invalid items are dropped, control characters removed, and a stored tag stays text', () => {
    const store = new MemoryStore();
    put(
      store,
      JSON.stringify({
        v: 1,
        items: [
          { k: 'm', id: 'not-a-uuid', l: 'Bad id' },
          { k: 'x', id: uuid(1), l: 'Bad kind' },
          { k: 'm', id: uuid(2), l: '   ' },
          { k: 'm', id: uuid(3), l: 'y'.repeat(121) },
          { k: 'c', id: uuid(4), l: 'Tab\tLtd\u0000' },
          { k: 'm', id: uuid(5), l: '<img src=x onerror=alert(1)>' },
        ],
      }),
    );
    const list = readRecents(store, 'a', X);
    expect(list.map((r) => r.id)).toEqual([uuid(4), uuid(5)]);
    expect(list[0]!.label).toBe('TabLtd');
    expect(list[1]!.label).toBe('<img src=x onerror=alert(1)>');
  });
  test('blocked or full storage means no recents and no error', () => {
    const blocked: RecentsStore = {
      get length(): number {
        throw new Error('blocked');
      },
      key() {
        throw new Error('blocked');
      },
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('full');
      },
      removeItem() {
        throw new Error('blocked');
      },
    };
    expect(readRecents(blocked, 'a', X)).toEqual([]);
    expect(rememberRecent(blocked, 'a', X, item(1))).toEqual([item(1)]);
    expect(forgetAllRecents(blocked)).toBe(0);
    expect(forgetOtherRecents(blocked, 'a')).toBe(0);
    expect(readRecents(null, 'a', X)).toEqual([]);
    expect(rememberRecent(null, 'a', X, item(1))).toEqual([]);
  });
  test('an unknown person or workspace reads and writes nothing', () => {
    const store = new MemoryStore();
    expect(rememberRecent(store, '', X, item(1))).toEqual([]);
    expect(rememberRecent(store, 'a', '', item(1))).toEqual([]);
    expect(store.length).toBe(0);
  });
});

describe('S3 recents go on every sign-out path', () => {
  const host = globalThis as { window?: unknown };
  const had = 'window' in host;
  const before = host.window;
  const restore = () => {
    if (had) host.window = before;
    else delete host.window;
  };
  test('forgetDeviceRecents removes every v1 list on the device and nothing else', () => {
    const store = new MemoryStore();
    rememberRecent(store, 'person-a', X, item(1));
    rememberRecent(store, 'person-b', Y, item(2));
    store.setItem('corridra:other', 'keep');
    host.window = { localStorage: store };
    try {
      expect(forgetDeviceRecents()).toBe(2);
      expect([...store.data.keys()]).toEqual(['corridra:other']);
    } finally {
      restore();
    }
  });
  test('it does not throw when storage is blocked or missing', () => {
    host.window = {
      get localStorage() {
        throw new Error('blocked');
      },
    };
    try {
      expect(() => forgetDeviceRecents()).not.toThrow();
      expect(forgetDeviceRecents()).toBe(0);
    } finally {
      restore();
    }
    expect(() => forgetDeviceRecents()).not.toThrow();
    expect(forgetDeviceRecents()).toBe(0);
  });
});
