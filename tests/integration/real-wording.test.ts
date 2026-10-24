import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Sample-only wording ("invalid hosts only", "Test email address", example.invalid and example host placeholders) is
// allowed in a customer form only as the sample branch of a realCustomerInput() choice, so a real user never reads it.
const root = resolve(__dirname, '../../apps/web/app/account');
const stale = [
  /invalid hosts only/,
  /Test email address/,
  /name@example\.invalid/,
  /https:\/\/company\.example/,
  /https:\/\/registry\.example/,
];
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.tsx') ? [path] : [];
  });
}

describe('customer forms keep sample wording out of real mode', () => {
  for (const file of files(root)) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of stale) {
      const match = pattern.exec(text);
      if (!match) continue;
      it(`${file.slice(root.length + 1)}: ${pattern.source} sits inside a realCustomerInput() choice`, () => {
        const before = text.slice(Math.max(0, match.index - 260), match.index);
        expect(before).toContain('realCustomerInput()');
      });
    }
  }
});
