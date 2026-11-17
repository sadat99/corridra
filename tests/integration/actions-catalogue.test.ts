import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  actionCatalogue,
  actionIds,
  liveActions,
  machineryRoute,
  plannedActions,
} from '../../apps/web/lib/actions/catalogue';
import { contextFromGates, gateSources } from '../../apps/web/lib/actions/gates';
import { matchActions } from '../../apps/web/lib/actions/match';
import { actionStates, stateCopy } from '../../apps/web/lib/actions/states';

describe('action catalogue shape', () => {
  test('ids are unique and every id has one entry', () => {
    const ids = actionCatalogue.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...actionIds].sort());
  });

  test('every entry lists at least 9 English phrases and typed, empty bn and zh fields', () => {
    for (const entry of actionCatalogue) {
      const phrases = [...entry.intent.phrases.en, ...entry.intent.synonyms];
      expect(phrases.length, entry.id).toBeGreaterThanOrEqual(9);
      expect(entry.intent.phrases.bn, entry.id).toEqual([]);
      expect(entry.intent.phrases.zh, entry.id).toEqual([]);
    }
  });

  test('every failure key exists in states.ts and every state has copy', () => {
    for (const state of actionStates) {
      expect(stateCopy[state], state).toBeTruthy();
      expect(stateCopy[state].line.length).toBeGreaterThan(3);
    }
    for (const entry of actionCatalogue)
      for (const key of Object.values(entry.failure))
        expect(stateCopy[key!], entry.id).toBeTruthy();
  });

  test('state copy is plain: no em dashes and never "No results"', () => {
    for (const state of actionStates) {
      expect(stateCopy[state].line).not.toMatch(/[—–]/);
      expect(stateCopy[state].line).not.toMatch(/no results/i);
    }
    expect(stateCopy.ready.line).toBe('Ready to continue');
    expect(stateCopy.preparable.line).toBe('I can prepare this');
    expect(stateCopy.needs_detail.line).toBe('One detail is needed');
    expect(stateCopy.needs_approval.line).toBe('This action needs your approval');
    expect(stateCopy.unconfirmed.line).toBe("Corridra couldn't confirm this action");
    expect(stateCopy.needs_team.line).toBe('This needs help from our team');
  });

  test('routes are fixed paths and AI never fills a route', () => {
    for (const entry of actionCatalogue) {
      expect(entry.service.route === '' || entry.service.route.startsWith('/')).toBe(true);
      expect(entry.ai.fillable).not.toContain('route');
    }
  });

  test('every route points at a page that exists', () => {
    const routes = [...actionCatalogue.map((entry) => entry.service.route), machineryRoute];
    for (const route of routes.filter((value) => value !== '')) {
      const path = route.split(/[?#]/)[0]!;
      expect(existsSync(`apps/web/app${path === '/' ? '' : path}/page.tsx`), route).toBe(true);
    }
  });

  test('an action without a route is planned and excluded from matching', () => {
    expect(plannedActions.map((e) => e.id)).toEqual(['ask_team']);
    for (const entry of liveActions) expect(entry.service.route.startsWith('/')).toBe(true);
    for (const entry of actionCatalogue)
      if (entry.service.route === '') expect(entry.planned).toBe(true);
  });

  test('every switch and module key in the catalogue has a gate mapping', () => {
    const on = contextFromGates({
      programmesEnabled: true,
      problemReportsOffered: true,
      hasWorkspace: true,
    });
    for (const entry of actionCatalogue) {
      for (const key of entry.authority.switches) {
        expect(gateSources, key).toHaveProperty(key);
        expect(on.switches, key).toHaveProperty(key);
      }
      for (const key of entry.authority.modules) {
        expect(gateSources, key).toHaveProperty(key);
        expect(on.modules, key).toHaveProperty(key);
      }
    }
  });

  test('contextFromGates passes the real answers and keeps support_case off', () => {
    const ctx = contextFromGates({
      programmesEnabled: false,
      problemReportsOffered: true,
      hasWorkspace: false,
    });
    expect(ctx).toEqual({
      switches: { delegations: false },
      modules: { problem_reports: true, support_case: false },
      hasWorkspace: false,
    });
    expect(
      contextFromGates({ programmesEnabled: true, problemReportsOffered: true, hasWorkspace: true })
        .modules.support_case,
    ).toBe(false);
    expect(matchActions('plan a trip', ctx).map((r) => r.id)).not.toContain('start_organise');
  });

  test('labels say what really happens and promise no explanation page', () => {
    for (const entry of actionCatalogue) {
      expect(entry.label.length, entry.id).toBeGreaterThan(3);
      expect(entry.label).not.toMatch(/[\u2014\u2013]/);
    }
    const byId = Object.fromEntries(actionCatalogue.map((e) => [e.id, e.label]));
    expect(byId.continue_draft).toBe('Open Your Workspaces to Pick Up a Draft');
    expect(byId.explain_blocked).toBe('Open Your Requests to See What Is Waiting');
    expect(byId.explain_blocked).not.toMatch(/why|explain/i);
  });

  test('each query key and hash of a route is honoured by its page', () => {
    const read = (path: string) => readFileSync(path, 'utf8');
    expect(read('apps/web/app/plan/intake.tsx')).toContain("query.get('job')");
    expect(read('apps/web/app/account/page.tsx')).toContain('view');
    expect(read('apps/web/app/account/page.tsx')).toContain('id="customer-workspaces"');
    for (const entry of actionCatalogue) {
      const query = entry.service.route.split('?')[1]?.split('#')[0];
      if (!query) continue;
      const key = query.split('=')[0];
      expect(['job', 'view'], `${entry.id} ${key}`).toContain(key);
    }
  });
});
