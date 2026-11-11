import type { Page } from '@playwright/test';

// Shared by the Stronger Colours specs (tests/browser/stronger-colours.spec.ts and the signed-in
// tests/e2e/verification/revamp-s2/w10-stronger-colours.spec.ts): the keyboard focus ring of every focusable element
// inside a set of regions, measured in the browser against the colour that really sits next to the ring.
//
// The ring is drawn outside the element when its outline offset is zero or more, so it sits on the colour behind the
// element; when the offset is negative it is drawn inside the element, on the element's own fill. The halo (the
// box-shadow ring the mode adds) is the colour right next to a ring with a positive offset. Each ring must reach 3 to 1
// (WCAG 2.2 non-text contrast) against every colour next to it.

export type RingRow = {
  element: string;
  /** The outline and halo the element really has, for the failure message. */
  outline: string;
  ring: string;
  /** What the ring is drawn on, and the least ratio against it (and against the halo, when there is one). */
  backdrop: string;
  ratio: number;
  width: number;
};

export type EdgeRow = {
  element: string;
  /** What shows the boundary of the control (its border, or its fill when it has no border), and what is behind it. */
  edge: string;
  backdrop: string;
  /** Edge against the colour behind the control. */
  edgeRatio: number;
  /** The control's own label against its fill. */
  labelRatio: number;
};

/**
 * In the mode now set on the page: the ring of every focusable element inside `regions`, one row each, and the boundary
 * of each control in `edges` (an action filled control on a coloured region) against the region behind it.
 */
export async function measureColours(
  page: Page,
  regions: string,
  edges: string[] = [],
): Promise<{ rings: RingRow[]; edges: EdgeRow[] }> {
  return page.evaluate(
    ([regionSelector, edgeSelectors]) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('no canvas');
      type Colour = [number, number, number, number];
      const parse = (value: string): Colour => {
        // The canvas turns any CSS colour (rgb, color(srgb ...), color-mix) into the pixel the page would show.
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = '#000';
        context.fillStyle = value;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
        return [r, g, b, a / 255];
      };
      const over = (top: Colour, below: Colour): Colour => [
        top[0] * top[3] + below[0] * (1 - top[3]),
        top[1] * top[3] + below[1] * (1 - top[3]),
        top[2] * top[3] + below[2] * (1 - top[3]),
        1,
      ];
      const luminance = ([r, g, b]: Colour) => {
        const lin = (c: number) =>
          (c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      };
      const ratio = (a: Colour, b: Colour) => {
        const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
        return (high + 0.05) / (low + 0.05);
      };
      // The colour a box shows: its own background laid over what is behind it, up to the first opaque one.
      const paint = (start: Element | null): Colour => {
        const layers: Colour[] = [];
        for (let el = start; el; el = el.parentElement) {
          const style = getComputedStyle(el);
          if (style.backgroundImage !== 'none')
            throw new Error(`a background image under ${el.tagName}`);
          const layer = parse(style.backgroundColor);
          if (layer[3] > 0) layers.push(layer);
          if (layer[3] === 1) break;
        }
        return layers.reduceRight((below, top) => over(top, below), [255, 255, 255, 1] as Colour);
      };
      const describe = (el: Element) =>
        `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''}${
          el.getAttribute('aria-selected')
            ? `[aria-selected=${el.getAttribute('aria-selected')}]`
            : ''
        } "${(el.textContent ?? el.getAttribute('aria-label') ?? '').trim().replace(/\s+/g, ' ').slice(0, 30)}"`;

      const focusable =
        'a[href], button, summary, input, select, textarea, [tabindex]:not([tabindex="-1"])';
      const seen = new Set<Element>();
      const rows: RingRow[] = [];
      for (const region of Array.from(document.querySelectorAll(regionSelector)))
        for (const el of Array.from(region.querySelectorAll<HTMLElement>(focusable))) {
          if (seen.has(el) || !el.checkVisibility()) continue;
          // Content of a closed disclosure is not rendered, so checkVisibility is false for it and it is skipped.
          seen.add(el);
          el.focus({ focusVisible: true } as FocusOptions);
          const style = getComputedStyle(el);
          const width = parseFloat(style.outlineWidth);
          const offset = parseFloat(style.outlineOffset);
          const ring = parse(style.outlineColor);
          const inside = offset < 0;
          // A ring inside the element is on the element's own fill; outside, on what is behind the element.
          const backdrop = paint(inside ? el : el.parentElement);
          const neighbours: Colour[] = [backdrop];
          // The halo is the colour between the element and a ring that stands off from it.
          const halo = style.boxShadow.match(/^(rgba?\([^)]*\)|color\([^)]*\))\s+0px 0px 0px 2px$/);
          if (!inside && halo) neighbours.push(over(parse(halo[1]), backdrop));
          const lowest = Math.min(...neighbours.map((colour) => ratio(over(ring, colour), colour)));
          rows.push({
            element: describe(el),
            outline: `${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor} offset ${style.outlineOffset}; shadow ${style.boxShadow}`,
            ring: style.outlineColor,
            backdrop: `rgb(${neighbours.map((colour) => colour.slice(0, 3).map(Math.round).join(' ')).join(') and (')})`,
            ratio: Math.round(lowest * 100) / 100,
            width,
          });
        }
      const edgeRows: EdgeRow[] = [];
      for (const selector of edgeSelectors)
        for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
          if (!el.checkVisibility()) continue;
          const style = getComputedStyle(el);
          const behind = paint(el.parentElement);
          const fill = parse(style.backgroundColor);
          // A border draws the boundary when there is one; a control without one is bounded by its fill.
          const bordered = parseFloat(style.borderTopWidth) >= 1;
          const edge = bordered ? parse(style.borderTopColor) : fill;
          edgeRows.push({
            element: describe(el),
            edge: bordered ? style.borderTopColor : style.backgroundColor,
            backdrop: `rgb(${behind.slice(0, 3).map(Math.round).join(' ')})`,
            edgeRatio: Math.round(ratio(edge, behind) * 100) / 100,
            labelRatio: Math.round(ratio(parse(style.color), fill) * 100) / 100,
          });
        }
      return { rings: rows, edges: edgeRows };
    },
    [regions, edges] as const,
  );
}

/** Rings that fail: under 3 to 1 against what they are drawn on, or thinner than 2 px. */
export const weakRings = (rows: RingRow[]) =>
  rows
    .filter((row) => row.ratio < 3 || row.width < 2)
    .map((row) => `${row.element}: ${row.ratio}:1 on ${row.backdrop}, ${row.outline}`);

/** Controls whose boundary is under 3 to 1 against the region behind them, or whose label is under 7 to 1 on its fill. */
export const weakEdges = (rows: EdgeRow[]) =>
  rows
    .filter((row) => row.edgeRatio < 3 || row.labelRatio < 7)
    .map(
      (row) =>
        `${row.element}: edge ${row.edge} is ${row.edgeRatio}:1 on ${row.backdrop}, label ${row.labelRatio}:1`,
    );
