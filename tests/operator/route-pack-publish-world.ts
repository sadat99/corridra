import type { Page } from '@playwright/test';
import { packNow, routeIds, type FactsWorld } from './p5c-desk-world';

// ADR-093 Phase 3, PR 3b: the fixture's answer to route-pack-publish, registered after answerReads (a later route wins). With
// the script empty it does what the server does (spec 17A): the version read plus 1 or 409 ROUTE_PACK_PACK_CHANGED, 409
// ROUTE_PACK_NO_CHANGE for a change that sets nothing new, an exact replay of a publish id is 200 duplicate and the same id with
// anything else is 409 ROUTE_PACK_COMMAND_REUSED; a preview writes nothing, a publish makes the next read show the new pack.
export type PublishWorld = {
  /** The next answers, one per request, before the server-like default. */
  script?: Array<{ status: number; code?: string; error?: string; body?: unknown }>;
  /** Every preview waits this many milliseconds before it is answered (to see the first step locked). */
  previewDelay?: number;
  /** False: the one-person module is not installed (default true). */
  onePerson?: boolean;
  /** Keys a preview names as `blocked` (the one go-live refusal). */
  blocked?: string[];
  /** Warnings a preview and a publish answer with. */
  warnings?: Array<{ code: string; keys: string[] }>;
  /** Every body the page sent, in order. */
  bodies: Array<{ mode: string; change: Record<string, unknown> }>;
  /** Publish ids already answered, with the change they came with. */
  answered: Record<string, { fingerprint: string; version: number }>;
};
const keyById: Record<string, string> = {
  [routeIds.bdCn]: 'BD-CN',
  [routeIds.bdEu]: 'BD-EU',
  [routeIds.twAu]: 'TW-AU',
};
const listKeys = [
  'missionTypes',
  'languages',
  'currencies',
  'timeZones',
  'localities',
  'clusters',
  'evidenceTypes',
  'sourceCategories',
  'coverage',
  'requiredCapabilities',
  'operatorCapabilities',
];

export async function answerPublish(
  page: Page,
  facts: FactsWorld,
  given: Partial<PublishWorld> = {},
): Promise<PublishWorld> {
  const world: PublishWorld = { bodies: [], answered: {}, ...given };
  await page.route('**/api/team-control/route-pack-publish*', async (route) => {
    const request = route.request();
    const json = (body: unknown, status: number) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const refuse = (status: number, error: string, code?: string) =>
      json({ error, ...(code ? { code } : {}), correlationId: 'fixture' }, status);
    if (request.method() !== 'POST') return refuse(404, 'Not found');
    const body = request.postDataJSON() as PublishWorld['bodies'][number];
    world.bodies.push(body);
    if (body.mode === 'preview' && world.previewDelay)
      await new Promise((resolve) => setTimeout(resolve, world.previewDelay));
    const scripted = world.script?.shift();
    if (scripted)
      return scripted.body !== undefined
        ? json(scripted.body, scripted.status)
        : refuse(
            scripted.status,
            scripted.error ?? 'The request could not be completed',
            scripted.code,
          );
    const change = body.change;
    const key = keyById[String(change.routeId)];
    if (!key) return refuse(400, 'Check the submitted values');
    const pack = packNow(facts, key);
    // requestedPack: a first pack needs its mission types (the server's exact words).
    if (
      !pack &&
      change.kind === 'settings' &&
      !(Array.isArray(change.missionTypes) && change.missionTypes.length)
    )
      return refuse(400, 'Choose at least one mission type.', 'ROUTE_PACK_INVALID');
    const before = (pack?.configuration ?? {}) as Record<string, unknown>;
    const next: Record<string, unknown> = structuredClone(before);
    let status: string = pack?.status ?? 'DRAFT';
    if (change.kind === 'status') status = String(change.status);
    for (const list of listKeys) if (Array.isArray(change[list])) next[list] = change[list];
    if (typeof change.manualChannel === 'boolean')
      next.channels = [change.manualChannel ? 'MANUAL' : 'SYNTHETIC'];
    if (change.removeSourcingProfile === true) delete next.sourcing;
    const changedKeys = [...new Set([...Object.keys(before), ...Object.keys(next)])].filter(
      (name) => JSON.stringify(before[name]) !== JSON.stringify(next[name]),
    );
    const fingerprint = JSON.stringify(
      change,
      Object.keys(change)
        .filter((k) => k !== 'commandId')
        .sort(),
    );
    if (body.mode === 'publish') {
      const earlier = world.answered[String(change.commandId)];
      if (earlier)
        return earlier.fingerprint === fingerprint
          ? json(
              { version: earlier.version, duplicate: true, warnings: [], removedPolicies: [] },
              200,
            )
          : refuse(409, 'Command key reused with different values', 'ROUTE_PACK_COMMAND_REUSED');
    }
    if (change.version !== (pack?.version ?? 0) + 1)
      return refuse(
        409,
        "This route's pack changed since you opened it. Reload and try again.",
        'ROUTE_PACK_PACK_CHANGED',
      );
    if (!changedKeys.length && status === (pack?.status ?? 'DRAFT') && pack)
      return refuse(
        409,
        'Nothing changes in this pack. Change a setting or the status first.',
        'ROUTE_PACK_NO_CHANGE',
      );
    const version = (pack?.version ?? 0) + 1;
    if (body.mode === 'preview')
      return json(
        {
          kind: change.kind,
          statusFrom: pack?.status ?? null,
          statusTo: status,
          changedKeys,
          baseVersion: pack?.version ?? null,
          newVersion: version,
          duplicate: false,
          historicalAssignmentsPreserved: 4,
          warnings: world.warnings ?? [],
          blocked: world.blocked
            ? { code: 'ROUTE_PACK_LOCKED_CORE_EMPTIED', keys: world.blocked }
            : null,
          onePersonPublication: world.onePerson !== false,
          removedPolicies: [],
        },
        200,
      );
    facts.packs ??= {};
    facts.packs[key] = { status: status as 'ACTIVE', version, configuration: next };
    world.answered[String(change.commandId)] = { fingerprint, version };
    return json(
      { version, duplicate: false, warnings: world.warnings ?? [], removedPolicies: [] },
      201,
    );
  });
  return world;
}
