import qrcode from 'qrcode-generator';

// The QR code of a public programme page (ADR-084 S1). It is made here, on our own server, by one pinned library that has no
// dependency and makes no network call, so the address of a page never leaves Corridra to be drawn. Byte mode, error
// correction level M, the smallest version that fits. A page address is about 100 to 130 characters, version 7 or 8.
export type QrCode = {
  /** Modules per side, without the quiet zone. */
  size: number;
  /** True where the module is dark. Row and column count from the top left. */
  dark: (row: number, column: number) => boolean;
};

export function makeQr(text: string): QrCode {
  if (text.length === 0 || text.length > 400) throw new Error('This address cannot be drawn');
  const code = qrcode(0, 'M');
  code.addData(text, 'Byte');
  code.make();
  return { size: code.getModuleCount(), dark: (row, column) => code.isDark(row, column) };
}

/** The quiet zone a scanner needs around the code: four modules. */
export const quietZone = 4;

/**
 * One SVG path for the whole code: a run of dark modules in a row is one rectangle. The path is in module units, inside a
 * square of `size + 2 * quietZone`, so the SVG scales to any size without blur.
 */
export function qrPath(code: QrCode): string {
  const parts: string[] = [];
  for (let row = 0; row < code.size; row++) {
    let column = 0;
    while (column < code.size) {
      if (!code.dark(row, column)) {
        column++;
        continue;
      }
      const start = column;
      while (column < code.size && code.dark(row, column)) column++;
      parts.push(
        `M${start + quietZone} ${row + quietZone}h${column - start}v1h-${column - start}z`,
      );
    }
  }
  return parts.join('');
}

export const qrViewBox = (code: QrCode) =>
  `0 0 ${code.size + 2 * quietZone} ${code.size + 2 * quietZone}`;

/**
 * The whole drawing as one SVG document, dark on light in plain black and white on purpose: a scanner needs that contrast
 * whatever the page theme is. It is meant to be used as an image address, so it loads nothing and calls nothing.
 */
export function qrSvg(code: QrCode): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${qrViewBox(code)}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><path d="${qrPath(code)}" fill="black"/></svg>`;
}

/** The drawing as an image address that holds the picture itself, so the page makes no request for it. */
export const qrDataAddress = (code: QrCode) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg(code))}`;
