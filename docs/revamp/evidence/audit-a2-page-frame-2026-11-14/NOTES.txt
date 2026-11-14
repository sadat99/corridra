# AUDIT-A2 evidence (14 November 2026)

Before (main 6a27f7e) and after (PR 495) pictures at 390, 768 and 1440 px, made from the real components and real stylesheets in a left-nav frame fixture (no webfonts, so type is a fallback; the heights, not the glyphs, are the evidence).

- `registrations`, `request`, `companies`: the frame pages (Delegation registrations, saved request, approved companies).
- `fee` (and `feeOpen`, after only): a fee schedule row; the open menu shows Retire Fee Schedule behind More actions.
- `menu`: the customer account menu open on a phone-width header (Sign Out pinned, Language as one row).
- `workspaces`: from `tests/operator/revamp-cx2b-workspaces.spec.ts`, 390 and 1440 only (that spec does not capture 768).

Fixture heights of the page column, before to after (px): registrations 358 to 353 (390), 340 to 306 (768), 257 to 213 (1440); request 408 to 366, 384 to 343, 295 to 250; companies 354 to 326, 355 to 327, 266 to 234; fee row 413 to 407, 346 to 340, 257 to 251.
