import { describe, expect, it } from 'vitest';
import { signInNavigationFindings, spreadAllowlist } from './sign-in-navigation-guard';

// The sign-in navigation guard (KI-30) on small sources: each way a soft navigation into operator
// sign-in slipped past the regex scan fails, and the same source without its offending part passes.
const link = "import Link from 'next/link';\n";
const router = "import { useRouter } from 'next/navigation';\n";
const check = (source: string) => signInNavigationFindings(source, 'fixture.tsx');

describe('the sign-in navigation guard', () => {
  const cases: { name: string; fails: string; passes: string }[] = [
    {
      name: 'an href held in a variable',
      fails: `${link}const h = '/operator/signin';\nexport const A = () => <Link href={h}>Sign in</Link>;`,
      passes: `${link}const h = '/workspace';\nexport const A = () => <Link href={h}>Sign in</Link>;`,
    },
    {
      name: 'an href held in a variable built from another variable',
      fails: `${link}const base = '/operator/signin';\nconst h = base + '?next=' + encodeURIComponent('/operator');\nexport const A = () => <Link href={h}>Sign in</Link>;`,
      passes: `${link}const base = '/workspace';\nconst h = base + '?next=' + encodeURIComponent('/operator');\nexport const A = () => <Link href={h}>Sign in</Link>;`,
    },
    {
      name: 'an href from a sign-in helper in a template',
      fails: `${link}export const A = ({ t }: { t: string }) => <Link href={\`/operator/signin?next=\${t}\`}>Sign in</Link>;`,
      passes: `${link}export const A = ({ t }: { t: string }) => <Link href={\`/workspace?next=\${t}\`}>Sign in</Link>;`,
    },
    {
      name: 'spread props on a Link',
      fails: `${link}export const A = (props: { href: string }) => <Link {...props}>Sign in</Link>;`,
      passes: `${link}export const A = (props: { href: string }) => <Link href={props.href}>Sign in</Link>;`,
    },
    {
      name: 'a default import under another name',
      fails: `import L from 'next/link';\nexport const A = () => <L href="/operator/signin">Sign in</L>;`,
      passes: `import L from 'next/link';\nexport const A = () => <L href="/workspace">Sign in</L>;`,
    },
    {
      name: 'the default export imported by name under another name',
      fails: `import { default as L } from 'next/link';\nexport const A = () => <L href="/operator/signin" />;`,
      passes: `import { default as L } from 'next/link';\nexport const A = () => <L href="/workspace" />;`,
    },
    {
      name: 'a namespace import',
      fails: `import * as N from 'next/link';\nexport const A = () => <N.default href="/operator/signin">Sign in</N.default>;`,
      passes: `import * as N from 'next/link';\nexport const A = () => <N.default href="/workspace">Sign in</N.default>;`,
    },
    {
      name: 'an element in a prop before the href',
      fails: `${link}const I = () => null;\nexport const A = () => <Link icon={<I />} href="/operator/signin">Sign in</Link>;`,
      passes: `${link}const I = () => null;\nexport const A = () => <Link icon={<I />} href="/workspace">Sign in</Link>;`,
    },
    {
      name: 'router.push with a literal',
      fails: `${router}export function A() { const router = useRouter(); return () => router.push('/operator/signin'); }`,
      passes: `${router}export function A() { const router = useRouter(); return () => router.push('/operator'); }`,
    },
    {
      name: 'router.replace with a variable',
      fails: `${router}const to = '/operator/signin';\nexport function A() { const router = useRouter(); return () => router.replace(to); }`,
      passes: `${router}const to = '/operator';\nexport function A() { const router = useRouter(); return () => router.replace(to); }`,
    },
    {
      name: 'router.replace with a sign-in helper, useRouter imported under another name',
      fails: `import { useRouter as useNav } from 'next/navigation';\nimport { operatorSignInPath } from './nav';\nexport function A() { const nav = useNav(); return () => nav.replace(operatorSignInPath('t', 's')); }`,
      passes: `import { useRouter as useNav } from 'next/navigation';\nimport { operatorSectionPath } from './nav';\nexport function A() { const nav = useNav(); return () => nav.replace(operatorSectionPath('s')); }`,
    },
    {
      name: 'useRouter().replace called directly',
      fails: `${router}export function A() { return useRouter().replace('/operator/signin'); }`,
      passes: `${router}export function A() { return useRouter().replace('/operator'); }`,
    },
    {
      name: 'a push taken out of useRouter',
      fails: `${router}export function A() { const { push: go } = useRouter(); return () => go('/operator/signin'); }`,
      passes: `${router}export function A() { const { push: go } = useRouter(); return () => go('/operator'); }`,
    },
    {
      name: 'useRouter through a namespace import',
      fails: `import * as navigation from 'next/navigation';\nexport function A() { const r = navigation.useRouter(); return () => r.push('/operator/signin'); }`,
      passes: `import * as navigation from 'next/navigation';\nexport function A() { const r = navigation.useRouter(); return () => r.push('/workspace'); }`,
    },
  ];
  for (const { name, fails, passes } of cases)
    it(`fails on ${name}, and passes without it`, () => {
      expect(check(fails)).toHaveLength(1);
      expect(check(fails)[0]).toMatch(/^fixture\.tsx:\d+: /);
      expect(check(passes)).toEqual([]);
    });

  it('allows a new tab, a plain anchor and a full page load into sign-in', () => {
    expect(
      check(
        `${link}export const A = () => <Link href="/operator/signin" target="_blank" rel="noopener noreferrer">Verify</Link>;`,
      ),
    ).toEqual([]);
    expect(
      check(`${link}export const A = () => <Link target={'_blank'} href="/operator/signin" />;`),
    ).toEqual([]);
    expect(check(`export const A = () => <a href="/operator/signin">Sign in</a>;`)).toEqual([]);
    expect(
      check(
        `import { operatorSignInPage } from './nav';\nexport function A() { window.location.replace(operatorSignInPage); window.location.assign('/operator/signin'); }`,
      ),
    ).toEqual([]);
    // A Link of another library, or a push on something that is not the Next router, is not seen.
    expect(
      check(
        `import Link from './my-link';\nexport const A = (h: { push(p: string): void }) => [<Link href="/operator/signin" />, h.push('/operator/signin')];`,
      ),
    ).toEqual([]);
  });

  it('a target other than _blank is still checked', () => {
    expect(
      check(`${link}export const A = () => <Link target="_self" href="/operator/signin" />;`),
    ).toHaveLength(1);
  });

  it('keeps every allowed spread with a reason a reviewer can check', () => {
    for (const entry of spreadAllowlist) {
      expect(entry.path).toMatch(/^apps\/web\/.+\.tsx$/);
      expect(entry.reason.trim().length, entry.path).toBeGreaterThan(20);
    }
  });
});
