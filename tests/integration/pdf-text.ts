import { inflateSync } from 'node:zlib';

// Reads back what a pdfkit PDF puts on each page, without a PDF library: objects are found by their numbers,
// streams are inflated, the font's ToUnicode map turns glyph ids back into text and its width table gives each
// line's width. Only the shapes pdfkit writes for these documents are understood.
export type PdfLine = { x: number; y: number; size: number; text: string; width: number };
export type PdfPage = { lines: PdfLine[] };
type PdfObject = { dict: string; stream?: Buffer };

const hexText = (hex: string) => {
  let out = '';
  for (let index = 0; index < hex.length; index += 4)
    out += String.fromCharCode(parseInt(hex.slice(index, index + 4), 16));
  return out;
};

export function pdfPages(pdf: Buffer): PdfPage[] {
  const source = pdf.toString('latin1');
  const objects = new Map<number, PdfObject>();
  for (const match of source.matchAll(/(\d+) 0 obj\n([\s\S]*?)\nendobj/g)) {
    const body = match[2]!;
    const at = body.indexOf('stream\n');
    if (at < 0) {
      objects.set(Number(match[1]), { dict: body.replace(/\s+/g, ' ') });
      continue;
    }
    const start = match.index! + match[0].indexOf('stream\n') + 'stream\n'.length;
    const length = body.slice(at + 'stream\n'.length).lastIndexOf('\nendstream');
    const raw = pdf.subarray(start, start + length);
    const dict = body.slice(0, at).replace(/\s+/g, ' ');
    objects.set(Number(match[1]), {
      dict,
      stream: dict.includes('FlateDecode') ? inflateSync(raw) : raw,
    });
  }
  const reference = (dict: string, key: string) =>
    Number(new RegExp(`/${key} (\\d+) 0 R`).exec(dict)?.[1]);
  const fontTables = new Map<number, { unicode: Map<number, string>; widths: number[] }>();
  const table = (fontId: number) => {
    const cached = fontTables.get(fontId);
    if (cached) return cached;
    const font = objects.get(fontId)!;
    const unicode = new Map<number, string>();
    const cmap = objects.get(reference(font.dict, 'ToUnicode'))!.stream!.toString('latin1');
    for (const range of cmap.matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*\[([^\]]*)\]/g)) {
      const first = parseInt(range[1]!, 16);
      [...range[3]!.matchAll(/<([0-9a-f ]+)>/g)].forEach((entry, offset) =>
        unicode.set(first + offset, hexText(entry[1]!.replaceAll(' ', ''))),
      );
    }
    const descendant = objects.get(Number(/DescendantFonts \[(\d+) 0 R\]/.exec(font.dict)![1]))!;
    const widths = (/\/W \[0 \[([^\]]*)\]/.exec(descendant.dict)?.[1] ?? '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number);
    const entry = { unicode, widths };
    fontTables.set(fontId, entry);
    return entry;
  };
  const pages = [...objects.entries()]
    .filter(([, object]) => /\/Type \/Page\b(?!s)/.test(object.dict))
    .sort(([a], [b]) => a - b);
  return pages.map(([, page]) => {
    const resources = objects.get(reference(page.dict, 'Resources'))!.dict;
    const fonts = new Map(
      [...(/\/Font << ([^>]*)>>/.exec(resources)?.[1] ?? '').matchAll(/\/(\w+) (\d+) 0 R/g)].map(
        (match) => [match[1]!, Number(match[2])] as const,
      ),
    );
    const content = objects.get(reference(page.dict, 'Contents'))!.stream!.toString('latin1');
    const lines: PdfLine[] = [];
    let x = 0,
      y = 0,
      size = 0,
      fontId = 0;
    for (const token of content.matchAll(
      /1 0 0 1 ([\d.]+) ([\d.]+) Tm|\/(\w+) ([\d.]+) Tf|\[((?:<[0-9a-f]*>|\s|-?[\d.]+)*)\] TJ/g,
    )) {
      if (token[1] !== undefined) {
        x = Number(token[1]);
        y = Number(token[2]);
      } else if (token[3] !== undefined) {
        fontId = fonts.get(token[3])!;
        size = Number(token[4]);
      } else {
        const { unicode, widths } = table(fontId);
        let text = '';
        let width = 0;
        for (const glyph of token[5]!.matchAll(/<([0-9a-f]*)>/g))
          for (let index = 0; index < glyph[1]!.length; index += 4) {
            const id = parseInt(glyph[1]!.slice(index, index + 4), 16);
            text += unicode.get(id) ?? '';
            width += ((widths[id] ?? 0) * size) / 1000;
          }
        lines.push({ x, y, size, text, width });
      }
    }
    return { lines };
  });
}
