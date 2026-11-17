import { existsSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { actionCatalogue, actionIds, machineryRoute } from '../../apps/web/lib/actions/catalogue';
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
});
