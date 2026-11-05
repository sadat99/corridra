import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isTitleCase } from '../../apps/web/lib/ux/title-case';

// Finds the words a person reads on a button, a button-styled link or a menu item in the customer area, from the
// source: plain text children and quoted words inside the same element (for example the two sides of a
// "saving or save" choice). Navigation destinations, headings and text links are not buttons and are not read.
export const customerRoots = [
  'apps/web/app/account',
  'apps/web/components/ux/customer-bar.tsx',
  'apps/web/components/ux/overflow-menu.tsx',
  'apps/web/components/mr',
  'apps/web/components/customer-shell.tsx',
];
// Programme delegations are another track's pages.
const skip = (path: string) => path.includes('/account/delegations/');

export function customerFiles(root = process.cwd()): string[] {
  const out: string[] = [];
  const walk = (path: string) => {
    if (skip(path + '/')) return;
    const info = statSync(path);
    if (info.isDirectory()) for (const name of readdirSync(path)) walk(join(path, name));
    else if (/\.tsx$/.test(path) && !skip(path)) out.push(path);
  };
  for (const entry of customerRoots) walk(join(root, entry));
  return out.sort();
}

const elements =
  /<(button|Link|a|MenuLink|MenuButton|MenuRadio)\b((?:[^>{]|\{[^}]*\})*)>([\s\S]*?)<\/\1>/g;
const buttonLike = (tag: string, attrs: string) =>
  tag === 'button' ||
  tag.startsWith('Menu') ||
  /className=(?:"[^"]*|\{`[^`]*)\b(?:button|primary-link|ux-bar-primary)\b/.test(attrs);

/** Every label on a button-like element whose words are not in Title Case. */
export function titleCaseFindings(file: string): { label: string; text: string }[] {
  const source = readFileSync(file, 'utf8');
  const found: { label: string; text: string }[] = [];
  for (const match of source.matchAll(elements)) {
    const [, tag, attrs, children] = match;
    if (!buttonLike(tag, attrs)) continue;
    const texts: string[] = [];
    // Plain text between tags and braces, then quoted words inside braces.
    const plain = children.replace(/\{[^}]*\}/g, '|').replace(/<[^>]*>/g, '|');
    for (const part of plain.split('|')) {
      const text = part.replace(/\s+/g, ' ').trim();
      if (/^[A-Z]/.test(text)) texts.push(text);
    }
    for (const quoted of children.matchAll(/(["'`])([A-Z][^"'`{}$]*?)\1/g))
      texts.push(quoted[2].trim());
    for (const text of texts) if (!isTitleCase(text)) found.push({ label: tag, text });
  }
  return found;
}
