import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// The one font of the programme preview image (ADR-084 S1). It is the Noto Sans Regular file the report renderer already
// ships (SIL Open Font License, packages/delivery/assets), read from disk and handed to the image renderer, so a title is
// never drawn with a font fetched from a third party. The renderer asks a font service for any character the font does not
// have, so every character the font does not have is removed from the words before they are drawn: nothing is requested.
export type PreviewFont = {
  name: string;
  data: Buffer;
  weight: 400;
  style: 'normal';
  /** True when the font has a glyph for the code point. */
  covers: (codePoint: number) => boolean;
};

/** The code points a font file draws, read from its character map (formats 4 and 12, the Unicode tables). */
export function coveredCodePoints(font: Uint8Array): Set<number> {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const covered = new Set<number>();
  let cmap = -1;
  for (let i = 0, n = view.getUint16(4); i < n; i++) {
    const record = 12 + i * 16;
    if (String.fromCharCode(...new Uint8Array(font.buffer, font.byteOffset + record, 4)) === 'cmap')
      cmap = view.getUint32(record + 8);
  }
  if (cmap < 0) return covered;
  for (let i = 0, n = view.getUint16(cmap + 2); i < n; i++) {
    const platform = view.getUint16(cmap + 4 + i * 8);
    const encoding = view.getUint16(cmap + 6 + i * 8);
    // Unicode tables only: platform 0, or Windows with encoding 1 (BMP) or 10 (full).
    if (!(platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10)))) continue;
    const table = cmap + view.getUint32(cmap + 8 + i * 8);
    const format = view.getUint16(table);
    if (format === 4) {
      const segments = view.getUint16(table + 6) / 2;
      const ends = table + 14;
      const starts = ends + segments * 2 + 2;
      const deltas = starts + segments * 2;
      const offsets = deltas + segments * 2;
      for (let s = 0; s < segments; s++) {
        const end = view.getUint16(ends + s * 2);
        const start = view.getUint16(starts + s * 2);
        const delta = view.getUint16(deltas + s * 2);
        const offset = view.getUint16(offsets + s * 2);
        for (let c = start; c <= end && c < 0xffff; c++) {
          let glyph = 0;
          if (offset === 0) glyph = (c + delta) & 0xffff;
          else {
            const at = offsets + s * 2 + offset + (c - start) * 2;
            const indexed = at + 2 <= view.byteLength ? view.getUint16(at) : 0;
            glyph = indexed === 0 ? 0 : (indexed + delta) & 0xffff;
          }
          if (glyph !== 0) covered.add(c);
        }
      }
    } else if (format === 12) {
      for (let g = 0, groups = view.getUint32(table + 12); g < groups; g++) {
        const at = table + 16 + g * 12;
        const start = view.getUint32(at);
        const end = view.getUint32(at + 4);
        const glyph = view.getUint32(at + 8);
        for (let c = start; c <= end; c++) if (glyph + (c - start) !== 0) covered.add(c);
      }
    }
  }
  return covered;
}

/**
 * The words as the font can draw them: every character the font has no glyph for (emoji, Chinese, Bengali and the like) is
 * removed, line breaks and other white space become one space, and the result is trimmed. An emptied value is the empty
 * string, so the caller decides what to show instead.
 */
export function printable(text: string, covers: (codePoint: number) => boolean): string {
  return [...text.replace(/[\s\p{Cc}]+/gu, ' ')]
    .filter((char) => covers(char.codePointAt(0)!))
    .join('')
    .replace(/ {2,}/g, ' ')
    .trim();
}

// Literal, narrowly scoped paths keep Next's file tracing to this one file (the same two places the report renderer reads
// from: the web application folder where `next start` runs, or the repository root).
let loaded: Promise<PreviewFont> | undefined;
export function previewFont(): Promise<PreviewFont> {
  loaded ??= (
    process.cwd().endsWith('/apps/web')
      ? readFile(resolve(process.cwd(), '../../packages/delivery/assets/NotoSans.ttf'))
      : readFile(resolve(process.cwd(), 'packages/delivery/assets/NotoSans.ttf'))
  ).then((data) => {
    const set = coveredCodePoints(data);
    return {
      name: 'Noto Sans',
      data,
      weight: 400,
      style: 'normal',
      covers: (codePoint) => set.has(codePoint),
    } satisfies PreviewFont;
  });
  // A failed read is tried again on the next request.
  loaded.catch(() => {
    loaded = undefined;
  });
  return loaded;
}
