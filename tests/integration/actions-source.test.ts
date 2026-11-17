import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const dir = 'apps/web/lib/actions';
const files = readdirSync(dir).filter((name) => name.endsWith('.ts'));
const read = (name: string) => readFileSync(`${dir}/${name}`, 'utf8');

describe('actions folder source guard', () => {
  test('has the four core files', () => {
    for (const name of ['contract.ts', 'catalogue.ts', 'match.ts', 'states.ts'])
      expect(files).toContain(name);
  });

  test('imports only palette-rank and its own files', () => {
    for (const name of files) {
      const imports = [...read(name).matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);
      for (const spec of imports)
        expect(spec === '../palette-rank' || /^\.\/[a-z-]+$/.test(spec), `${name}: ${spec}`).toBe(
          true,
        );
    }
  });

  test('no server-only, intelligence, network, storage, console or clock', () => {
    const banned = [
      /server-only/,
      /packages\/intelligence/,
      /\bfetch\s*\(/,
      /localStorage|sessionStorage|indexedDB/,
      /\bconsole\./,
      /Date\.now|new Date\(|Math\.random/,
      /XMLHttpRequest|WebSocket|process\.env/,
    ];
    for (const name of files)
      for (const pattern of banned) expect(read(name), `${name} ${pattern}`).not.toMatch(pattern);
  });

  test('no em dashes in the source', () => {
    for (const name of files) expect(read(name)).not.toMatch(/—/);
  });
});
