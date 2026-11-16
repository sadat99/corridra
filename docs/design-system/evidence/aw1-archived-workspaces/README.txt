AW-1 archived workspaces: before and after captures

Six screens at 390, 768 and 1440 px, in before/ and after/ under the same file names.
Before: origin/main ec734371 (merge of PR 524).
After: branch claude/archived-workspace-hide at bd2651a2 (fix round 2 code commits).
Captured 16 November 2026 with the same fixture on both trees: the real customer header, rail and page
components mounted in Chromium with every read scripted (synthetic data, no database, no signed-in live
check). The fixture loads globals.css and the bundled component styles but not the web fonts, so text shows
in fallback faces. The programmes chooser is a server component: its HTML was rendered with the reads
answered by a test, then shown in the same fixture. PNGs are reduced to a 128 colour palette.

menu-archived-current-390.png, -768.png, -1440.png
  Account menu open on an archived workspace's own page (one archived and one active owned workspace).
  Viewport only.
menu-all-archived-390.png, -768.png, -1440.png
  Account menu open when every workspace is archived (one owned, one as member). Viewport only.
account-archived-view-390.png, -768.png, -1440.png
  /account workspaces list with the Archived view chosen where the tree offers it (one active, two
  archived). Full page.
programmes-chooser-all-archived-390.png, -768.png, -1440.png
  Programmes workspace chooser when both workspaces that could organise are archived. Full page.
service-request-all-archived-390.png, -768.png, -1440.png
  New help request without a workspace in the link, when the only owned workspace is archived (an active
  membership exists). Full page.
delegate-path-all-archived-390.png, -768.png, -1440.png
  Delegate path for a joined programme when every workspace is archived. Full page.
