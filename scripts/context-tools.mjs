import { relative, resolve, sep } from 'node:path';

// Pure helpers for bounded Markdown reads. They never read the repository themselves.

export function safeMarkdownPath(input, root = process.cwd()) {
  const rel = relative(root, resolve(root, input)).split(sep).join('/');
  const allowed =
    !rel.startsWith('..') &&
    rel.endsWith('.md') &&
    (rel.startsWith('docs/') || ['AGENTS.md', 'CLAUDE.md', 'README.md'].includes(rel));
  if (!allowed)
    throw new Error('Path must be Markdown under docs/ or AGENTS.md, CLAUDE.md, README.md');
  return rel;
}

export function headings(text) {
  const found = [];
  let fence = null;
  let line = 0;
  let offset = 0;
  for (const raw of text.split('\n')) {
    line += 1;
    const marker = /^\s*(`{3,}|~{3,})/.exec(raw);
    if (marker) {
      const kind = marker[1][0];
      if (fence === null) fence = kind;
      else if (fence === kind) fence = null;
    } else if (fence === null) {
      const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(raw);
      if (match) found.push({ level: match[1].length, title: match[2], line, offset });
    }
    offset += raw.length + 1;
  }
  for (const [index, heading] of found.entries()) {
    const next = found.slice(index + 1).find((item) => item.level <= heading.level);
    heading.end = next ? next.offset : text.length;
    heading.bytes = Buffer.byteLength(text.slice(heading.offset, heading.end));
  }
  return found;
}

export function outline(text, { last = 0, maxLevel = 3 } = {}) {
  let rows = headings(text).filter((heading) => heading.level <= maxLevel);
  if (last > 0) rows = rows.slice(-last);
  return rows
    .map((row) => `${row.line}\t${row.bytes}\t${'#'.repeat(row.level)} ${row.title}`)
    .join('\n');
}

export function section(text, query, { nth = 1, tail = 0 } = {}) {
  const all = headings(text);
  const needle = String(query).trim().toLowerCase();
  assert(needle, 'Section query is empty');
  let matches;
  if (/^\d+$/.test(needle)) matches = all.filter((heading) => heading.line === Number(needle));
  else {
    const exact = all.filter((heading) => heading.title.toLowerCase() === needle);
    matches = exact.length ? exact : all.filter((h) => h.title.toLowerCase().includes(needle));
  }
  assert(matches.length, `No heading matches: ${query}`);
  assert(nth >= 1 && nth <= matches.length, `--nth must be 1 to ${matches.length}`);
  const chosen = matches[nth - 1];
  let body = text.slice(chosen.offset, chosen.end).trimEnd();
  const lastLine = chosen.line + body.split('\n').length - 1;
  let cut = '';
  if (tail > 0 && Buffer.byteLength(body) > tail) {
    const kept = Buffer.from(body)
      .subarray(-tail)
      .toString()
      .replace(/^�+/, '')
      .replace(/^[^\n]*\n/, '');
    cut = `; last ${Buffer.byteLength(kept)} bytes only`;
    body = kept;
  }
  const note = `<!-- section "${chosen.title}" lines ${chosen.line}-${lastLine}; match ${nth} of ${matches.length}${cut} -->`;
  return `${note}\n${body}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function budgetRows(groups, sizeOf) {
  const lines = [];
  for (const [label, files] of groups) {
    let total = 0;
    for (const file of files) {
      const bytes = sizeOf(file);
      total += bytes;
      lines.push(`${label}\t${file}\t${bytes}\t~${Math.ceil(bytes / 4)}`);
    }
    lines.push(`${label}\tSUBTOTAL\t${total}\t~${Math.ceil(total / 4)}`);
  }
  return lines.join('\n');
}
