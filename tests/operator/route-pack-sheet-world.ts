import type { Page } from '@playwright/test';
import type { FactVersion } from '../../apps/web/lib/route-pack-editor-read';
import type { SheetReport, SheetRoutePlan } from '../../packages/missions/src/route-pack-sheet';
import { routeIds } from './p5c-desk-world';

// ADR-093 Phase 3, PR 4: the fixture's answers to route-pack-import, route-pack-export and route-pack-fact-history, registered
// after answerReads (a later route wins). With the scripts empty it does what the server does (spec 12.1, 12.2, 17A): a check
// answers the world's report, a save answers 201 with every route saved, an export answers a CSV under its dated name, and the
// fact history answers the world's versions. Every request is kept, so a test can see that none was sent.
export type Scripted = { status: number; body?: unknown; delay?: number };
export type SheetWorld = {
  /** The next answers of a check, one per request, before the default. */
  checkScript?: Scripted[];
  /** The next answers of a save, one per request, before the default. */
  saveScript?: Scripted[];
  /** The next answers of an export, one per request, before the default. */
  exportScript?: Scripted[];
  /** Every check waits this many milliseconds (to see the busy state). */
  checkDelay?: number;
  /** Every save waits this many milliseconds (to see the locked dialog). */
  saveDelay?: number;
  /** Every export waits this many milliseconds. */
  exportDelay?: number;
  /** The report of a clean check. Left out, `cleanReport()`. */
  report?: SheetReport;
  /** Status of the fact history read. Default 200. */
  factHistory?: number;
  /** The fact versions of every route. Left out, `factVersions()`. */
  versions?: FactVersion[];
  /** Every body sent to route-pack-import, in order. */
  bodies: Array<{ mode: string; csv: string; saveId?: string; reason?: string }>;
  /** The routes query word of every export, in order. */
  exports: string[];
  /** The routeId of every fact history read, in order. */
  factReads: string[];
};
export const exportName = 'route-packs-2026-11-27.csv';
const change = (key: string, label: string) => ({ key, label });
export const plan = (route: string, over: Partial<SheetRoutePlan> = {}): SheetRoutePlan => ({
  route,
  routeId: route === 'BD-CN' ? routeIds.bdCn : null,
  willBeAdded: route !== 'BD-CN',
  pack: { changed: false, changedFields: [], status: 'DRAFT', nextVersion: null },
  content: {
    changed: true,
    nextVersion: 1,
    added: [change('market.notes', 'Market notes')],
    updated: [],
    removed: [],
    sectionMarks: { added: [], removed: [] },
  },
  skipped: [],
  completeness: { pendingCore: [], pendingOptionalCount: 0 },
  goLive: { ok: true, warnings: [] } as unknown as SheetRoutePlan['goLive'],
  ...over,
});
/** Bangladesh to China gains two facts, changes one and its working languages (pack version 3); China to Bangladesh is new. */
export function cleanReport(): SheetReport {
  return {
    mode: 'dry-run',
    ok: true,
    errors: [],
    warnings: [],
    readinessInvalidated: true,
    routes: [
      plan('BD-CN', {
        pack: { changed: true, changedFields: ['languages'], status: 'ACTIVE', nextVersion: 3 },
        content: {
          changed: true,
          nextVersion: 6,
          added: [change('market.notes', 'Market notes'), change('custom.port_fee', 'Port fee')],
          updated: [change('logistics.usual_modes', '')],
          removed: [],
          sectionMarks: { added: [], removed: [] },
        },
        skipped: [
          {
            row: 9,
            key: 'custom.season',
            message: 'Skipped: a Pending row does not create a custom field.',
          },
        ],
      }),
      plan('CN-BD'),
    ],
  };
}
/** Six versions, newest first: the newest by you, one with no reason. */
export function factVersions(): FactVersion[] {
  return [6, 5, 4, 3, 2, 1].map((version) => ({
    id: `00000000-0000-4000-8000-0000000009${String(version).padStart(2, '0')}`,
    version,
    packId: null,
    createdAt: `2026-11-${String(20 + version).padStart(2, '0')}T09:00:00.000Z`,
    createdByYou: version % 2 === 0,
    reason: version === 4 ? '' : `Sample reason for version ${version}`,
  }));
}
/** A save answer with every route of the report saved. */
export const savedReport = (report: SheetReport): SheetReport => ({
  ...report,
  mode: 'save',
  saved: report.routes.map((item, index) => ({
    route: item.route,
    routeId: item.routeId ?? `00000000-0000-4000-8000-00000000099${index}`,
    contentVersion: item.content.changed ? item.content.nextVersion : null,
    packVersion: item.pack.changed ? item.pack.nextVersion : null,
  })),
});

export async function answerSheet(
  page: Page,
  given: Partial<SheetWorld> = {},
): Promise<SheetWorld> {
  const world: SheetWorld = { bodies: [], exports: [], factReads: [], ...given };
  const json = (body: unknown, status: number) => ({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
  const wait = (ms?: number) => (ms ? new Promise((resolve) => setTimeout(resolve, ms)) : null);
  await page.route('**/api/team-control/route-pack-import*', async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') return route.fulfill(json({ error: 'Not found' }, 404));
    const body = request.postDataJSON() as SheetWorld['bodies'][number];
    world.bodies.push(body);
    const save = body.mode === 'save';
    const scripted = (save ? world.saveScript : world.checkScript)?.shift();
    await (wait(scripted?.delay) ?? wait(save ? world.saveDelay : world.checkDelay));
    if (scripted) return route.fulfill(json(scripted.body ?? { error: 'Failed' }, scripted.status));
    const report = world.report ?? cleanReport();
    return save ? route.fulfill(json(savedReport(report), 201)) : route.fulfill(json(report, 200));
  });
  await page.route('**/api/team-control/route-pack-export*', async (route) => {
    const url = new URL(route.request().url());
    world.exports.push(url.searchParams.get('routes') ?? '');
    const scripted = world.exportScript?.shift();
    await (wait(scripted?.delay) ?? wait(world.exportDelay));
    if (scripted) return route.fulfill(json(scripted.body ?? { error: 'Failed' }, scripted.status));
    return route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename=${exportName}`,
      },
      body: '﻿route,section\r\nBD-CN,Identity\r\n',
    });
  });
  await page.route('**/api/team-control/route-pack-fact-history*', async (route) => {
    const url = new URL(route.request().url());
    world.factReads.push(url.searchParams.get('routeId') ?? '');
    const code = world.factHistory ?? 200;
    if (code !== 200)
      return route.fulfill(json({ error: 'The request could not be completed' }, code));
    return route.fulfill(json({ versions: world.versions ?? factVersions() }, 200));
  });
  return world;
}
