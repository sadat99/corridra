import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  templateContent,
  templateSaveInput,
} from '../../packages/auth/src/customer-programme-templates';
import { switchRegistry } from '../../apps/web/lib/owner-switches';
import { uxSwitchNames, uxSwitchOn } from '../../apps/web/lib/ux-switches';
import {
  buyingTripActivities,
  buyingTripActivityText,
  buyingTripStarterId,
  buyingTripStarterLabel,
  buyingTripStarterSave,
} from '../../apps/web/app/account/delegations/buying-trip-starter';

// ADR-084 slice S7: the Buying Trip starter template. A generic plan, tasks only, saved through the existing template
// save command. These tests cover the words, the switch and the wiring; the screens are in
// tests/operator/del-s7-buying-trip.spec.ts.
const switchName = 'CORRIDRA_DELEGATION_BUYING_TRIP';
const read = (path: string) => readFileSync(resolve(path), 'utf8');
const everyWord = (sample: boolean) => {
  const starter = buyingTripStarterSave(sample);
  return [
    starter.name,
    starter.description,
    starter.content.reportingPurpose,
    ...starter.content.tasks.flatMap((t) => [t.title, t.detail ?? '']),
    buyingTripStarterLabel,
    ...buyingTripActivities,
  ];
};

describe('the starter words', () => {
  it('pass the existing template rules in a sample workspace, where every private word starts with Synthetic', () => {
    const starter = buyingTripStarterSave(true);
    expect(templateContent.safeParse(starter.content).success).toBe(true);
    const save = templateSaveInput.safeParse({
      commandId: '00000000-0000-4000-8000-000000000001',
      workspaceId: '00000000-0000-4000-8000-000000000002',
      templateId: null,
      expectedVersion: 0,
      retired: false,
      ...starter,
    });
    expect(save.success, JSON.stringify(save.error?.issues)).toBe(true);
    for (const word of [
      starter.name,
      starter.description,
      starter.content.reportingPurpose,
      ...starter.content.tasks.flatMap((t) => [t.title, t.detail ?? '']),
    ])
      expect(word.startsWith('Synthetic '), word).toBe(true);
  });

  it('in a real workspace carry no Synthetic marker and keep the same plan', () => {
    const real = buyingTripStarterSave(false);
    const sample = buyingTripStarterSave(true);
    expect(real.name).toBe('Buying trip');
    expect(real.content.tasks).toHaveLength(6);
    expect(real.content.tasks.map((t) => 'Synthetic ' + t.title)).toEqual(
      sample.content.tasks.map((t) => t.title),
    );
    for (const word of everyWord(false)) expect(word).not.toMatch(/Synthetic/);
    for (const word of everyWord(false)) expect(word.length).toBeGreaterThanOrEqual(2);
  });

  it('seed tasks only: six tasks, no cost, no capacity, no date, no person, no figure', () => {
    for (const sample of [true, false]) {
      const { content } = buyingTripStarterSave(sample);
      expect(content.tasks).toHaveLength(6);
      expect(content.plannedCosts).toEqual([]);
      expect(content.capacity).toBeNull();
      for (const task of content.tasks) {
        expect(task.dueOffsetDays).toBeNull();
        expect(task.assigneeLabel).toBeNull();
      }
      for (const word of everyWord(sample)) expect(word, word).not.toMatch(/\d/);
    }
  });

  it('make no claim, price, country or urgency, and use no em dash', () => {
    for (const word of everyWord(true)) {
      expect(word, word).not.toMatch(/[—–]/);
      expect(word, word).not.toMatch(
        /verified|qualified|guarantee|best price|cheap|save|discount|only today|limited|hurry/i,
      );
      expect(word, word).not.toMatch(
        /china|bangladesh|dhaka|guangzhou|shenzhen|\$|€|£|usd|bdt|cny/i,
      );
    }
    expect(new Set(buyingTripActivities).size).toBe(buyingTripActivities.length);
  });

  it('make the host an organiser statement and leave entry and visa checks to the traveller and the official source', () => {
    const all = buyingTripStarterSave(false).content.tasks.map((t) => t.title + ' ' + t.detail);
    expect(all.join(' ')).toMatch(/Corridra does not check/);
    expect(all.join(' ')).toMatch(/official source/);
  });

  it('offer three page lines, each a plain line the page accepts, and the select value is not a template id', () => {
    expect(buyingTripActivities).toHaveLength(3);
    for (const line of buyingTripActivities) {
      expect(line.length).toBeGreaterThanOrEqual(3);
      expect(line.length).toBeLessThanOrEqual(160);
    }
    expect(buyingTripActivityText.split('\n')).toEqual([...buyingTripActivities]);
    expect(buyingTripStarterId).not.toMatch(/^[0-9a-f]{8}-/);
  });
});

describe('the starter is a switch, off by default, and adds no server surface', () => {
  const page = read('apps/web/app/account/delegations/[workspaceId]/page.tsx');
  const list = read('apps/web/app/account/delegations/customer-programmes.tsx');
  const firstRun = read('apps/web/app/account/delegations/first-run.tsx');
  const picker = read('apps/web/app/account/delegations/programme-templates.tsx');

  it('is a described owner switch of its own, on only for exactly "true", and not the first run switch', () => {
    expect(uxSwitchNames).toContain(switchName);
    expect(uxSwitchOn(switchName, {})).toBe(false);
    for (const value of ['TRUE', '1', 'yes', 'on', ' true'])
      expect(uxSwitchOn(switchName, { [switchName]: value }), value).toBe(false);
    expect(uxSwitchOn(switchName, { [switchName]: 'true' })).toBe(true);
    // The first run switch is on in production; turning it on must not turn the starter on.
    expect(uxSwitchOn(switchName, { CORRIDRA_DELEGATION_FIRST_RUN: 'true' })).toBe(false);
    const entry = switchRegistry.find((s) => s.name === switchName);
    expect(entry?.kind).toBe('flag');
    expect(entry?.group).toBe('Programmes and delegations');
    expect(entry?.line).not.toMatch(/[—–]/);
  });

  it('is passed down as one prop from the page and acts only where programme templates are on', () => {
    expect(page).toContain(`buyingTripEnabled={uxSwitchOn('${switchName}')}`);
    expect(list).toContain('buyingTripEnabled = false');
    expect(list).toContain('buyingTrip={buyingTripEnabled}');
    expect(firstRun).toContain('buyingTrip = false');
    expect(firstRun).toMatch(/buyingTrip &&\s+templatesEnabled/);
    expect(picker).toContain('buyingTrip = false');
  });

  it('saves through the existing save command, once, and adds no route, command or payload field', () => {
    expect(firstRun).toContain("action: 'save'");
    expect(firstRun).toContain('starterSaveId');
    expect(picker).toContain("post('save', input,");
    expect(firstRun).not.toMatch(/fetch\('\/api\/(?!customer-)/);
  });
});
