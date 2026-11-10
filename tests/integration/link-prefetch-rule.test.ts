import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// The prefetch rule (W10): every next/link Link carries prefetch={false}, so no page fetches other pages in the
// background. The rule lives in eslint.config.mjs as no-restricted-syntax; this runs the real repository config on
// small sources, so the rule itself cannot silently stop reporting, and then over apps/web, so no Link slips through.
// The same config `pnpm lint` passes with --config; apps/web has a smaller config of its own that a file there would pick up.
const eslint = new ESLint({ cwd: process.cwd(), overrideConfigFile: 'eslint.config.mjs' });
const sampleFile = 'apps/web/app/prefetch-rule-sample.tsx';
const link = "import Link from 'next/link';\n";
const lint = async (source: string) => {
  const [result] = await eslint.lintText(source, { filePath: sampleFile });
  return result.messages.filter((message) => message.ruleId === 'no-restricted-syntax');
};

describe('the Link prefetch rule', () => {
  it('reports a Link without prefetch, and passes the same Link with prefetch={false}', async () => {
    const without = await lint(
      `${link}export const A = () => <Link href="/network">About</Link>;\n`,
    );
    expect(without.map((m) => m.ruleId)).toEqual(['no-restricted-syntax']);
    expect(without[0].message).toContain('prefetch={false}');
    expect(
      await lint(
        `${link}export const A = () => <Link prefetch={false} href="/network">About</Link>;\n`,
      ),
    ).toEqual([]);
  });

  it('reports prefetch={true}, a bare prefetch, a computed prefetch and a spread that might carry it', async () => {
    for (const element of [
      '<Link prefetch={true} href="/network" />',
      '<Link prefetch href="/network" />',
      '<Link prefetch={flag} href="/network" />',
      '<Link prefetch="false" href="/network" />',
      '<Link {...props} href="/network" />',
    ]) {
      const messages = await lint(
        `${link}export const A = ({ flag, props }: { flag: boolean; props: object }) => ${element};\n`,
      );
      expect(
        messages.map((m) => m.ruleId),
        element,
      ).toEqual(['no-restricted-syntax']);
    }
  });

  it('is not satisfied by a prefetch prop inside another prop of the same Link', async () => {
    const messages = await lint(
      `${link}import { Other } from './other';\nexport const A = () => <Link icon={<Other prefetch={false} />} href="/network" />;\n`,
    );
    expect(messages.map((m) => m.ruleId)).toEqual(['no-restricted-syntax']);
  });

  it('reports every Link of a file that lacks it, and only those', async () => {
    const messages = await lint(
      `${link}export const A = () => (\n  <>\n    <Link href="/a" />\n    <Link prefetch={false} href="/b" />\n    <Link href="/c" />\n  </>\n);\n`,
    );
    expect(messages.map((m) => m.line)).toEqual([4, 6]);
  });

  it('cannot be avoided by importing next/link under another name', async () => {
    for (const importLine of [
      "import L from 'next/link';",
      "import { default as L } from 'next/link';",
      "import * as L from 'next/link';",
    ]) {
      const messages = await lint(
        `${importLine}\nexport const A = () => <L.default href="/a" />;\n`,
      );
      expect(
        messages.some(
          (m) => m.ruleId === 'no-restricted-syntax' && m.message.includes('import Link'),
        ),
        importLine,
      ).toBe(true);
    }
  });

  it('leaves a plain anchor and a component of another name alone', async () => {
    expect(
      await lint(
        `import Button from './button';\nexport const A = () => <><Button href="/a" /><a href="/b">B</a></>;\n`,
      ),
    ).toEqual([]);
  });

  it('finds no Link without prefetch={false} anywhere in apps/web', async () => {
    const results = await eslint.lintFiles(['apps/web']);
    const violations = results.flatMap((result) =>
      result.messages
        .filter((m) => m.ruleId === 'no-restricted-syntax')
        .map((m) => `${result.filePath}:${m.line}: ${m.message}`),
    );
    expect(violations).toEqual([]);
  }, 180_000);
});
