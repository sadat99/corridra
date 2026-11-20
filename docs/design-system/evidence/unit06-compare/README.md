# Unit 06 Compare: screenshots and sizes

Evidence for the UI/UX.v4 row "Compare" (owner approval of 20 November 2026). Every name and figure in these screenshots is invented sample data.

- `compare-{2,3,10}-{320,390,768,1440}.png`: the shared `CompareGrid` with 2, 3 and 10 suppliers at four widths, Differences Only on (the default). Taken by `tests/ux/compare-grid.spec.ts` with `COMPARE_SHOTS_DIR` set.
- `compare-10-390-scrolled.png`: scrolled sideways; the row label column stays frozen and casts its edge shadow.
- `compare-10-320-ar.png`: Arabic, right to left; the frozen column is on the right.
- `compare-10-390-forced.png`: forced colours; system colours, a real edge line, hatched and striped squares still drawn, no fade.
- `handoff-notice-{390,1440}.png` and `commissioning-compare-{390,1440}.png`: the Room comparison with the notice and the one action under the table. Taken by `tests/operator/ux-room.spec.ts` with `UX_SHOTS_DIR` set.

The fixtures run without the product fonts, so the type face in the screenshots is the fallback; sizes and layout are real.

## Sizes

| Thing                       | Before (Room comparison)                     | Board                  | Chosen                                                                                 |
| --------------------------- | -------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------- |
| "Compare quotes" heading    | none (region name only)                      | serif heading          | `--text-compare-h` clamp(1.5rem, 1.35rem + 0.65vw, 1.75rem), 24 to 28 px, serif 500    |
| Values                      | 14 px, 500                                   | 16 px                  | 16 px, 500; prices 16 px, 600, tabular                                                 |
| Row labels                  | 14 px, 500, column 15 percent                | 14 px                  | 14 px, 500; column `--compare-label-w` clamp(5.5rem, 24cqi, min(38cqi, 12rem)), frozen |
| Second lines                | 12 px                                        | 14 px                  | 14 px; nothing under 12 px                                                             |
| Supplier columns            | equal share; phone: one card per supplier    | two columns on a phone | 8rem to 22rem; two fit at 390, three or more scroll in the region                      |
| Not stated and Excluded     | 28 by 14 px fill (cards), 12 px word (table) | 30 px hatched          | 30 by 30 px square, word 16 px 600, line 14 px                                         |
| Verdict                     | bottom row, 12 px capsule                    | on top of each column  | in each column head, 14 px 600, 20 px seal                                             |
| The one action              | 44 px text link "Ask a Question"             | 60 px                  | `--compare-action-h` 56 px on a phone, 48 px from 768 px (midpoint), cobalt            |
| Differences Only, Show Them | 44 px checkbox row, off by default           | on by default          | 44 px button, on by default; Show Them a 44 px text button                             |
