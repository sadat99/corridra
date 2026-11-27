import { describe, expect, test } from 'vitest';
import type { RouteConfiguration } from '../../packages/domain/src/corridors';
import {
  coreKeysV1,
  deriveCompleteness,
  routePackSections,
  standardFieldByKey,
  standardFieldsV1,
  type ContentDocument,
  type ContentFact,
} from '../../packages/domain/src/route-pack-standard';
import {
  addressFor,
  coreListWords,
  defaultView,
  fieldView,
  factsByKey,
  gapsLine,
  markedButOpen,
  optionalLine,
  packChangeLine,
  parseAddress,
  progressWords,
  readinessLine,
  routeIdOf,
  sectionLines,
  sectionParts,
  sourceWords,
  staleLine,
  staleListWords,
  todoCount,
  todoItems,
  valueWords,
} from '../../apps/web/lib/route-pack-editor-view';
import type { RouteSummary } from '../../apps/web/lib/route-pack-editor-read';

// ADR-093 Phase 3, PR 1: the pure helpers of the editor. No database, no browser.
const today = '2026-11-27';
const draft = { status: 'TESTING' as const, configuration: {} };
const fact = (key: string, extra: Partial<ContentFact> = {}) =>
  ({
    key,
    state: 'FILLED',
    value: 'Sample route fact',
    source: 'staff knowledge',
    observedOn: '2026-11-01',
    ...extra,
  }) as ContentFact;
const documentOf = (facts: ContentFact[], sectionMarks: ContentDocument['sectionMarks'] = []) =>
  ({ standardVersion: 1, sectionMarks, facts }) as ContentDocument;
const firstContentCore = standardFieldsV1.find((field) => field.part === 'Content' && field.core)!;

describe('the address', () => {
  test('parse and build round trip, keeping the workspace, the tab and the hash', () => {
    const next = addressFor(
      '/operator/settings?workspace=w1&tab=settings-policies#workspace-settings',
      {
        route: 'BD-CN',
        view: 'sections',
      },
    );
    expect(next).toBe(
      '/operator/settings?workspace=w1&tab=settings-policies&route=BD-CN&view=sections#workspace-settings',
    );
    expect(parseAddress(new URL(next, 'https://x.invalid').search)).toEqual({
      route: 'BD-CN',
      view: 'sections',
      section: null,
      sectionUnknown: false,
    });
    const section = addressFor(next, { route: 'BD-CN', section: 5 });
    expect(section).toContain('route=BD-CN&section=5');
    expect(section).not.toContain('view=');
    expect(parseAddress(new URL(section, 'https://x.invalid').search).section).toBe(5);
  });

  test('closing the route removes route, view and section and nothing else', () => {
    expect(
      addressFor('/operator/settings?workspace=w1&route=BD-CN&view=todo&section=3', {
        route: null,
      }),
    ).toBe('/operator/settings?workspace=w1');
  });

  test('a view that is not one of the two, and a section that is not one of the standard, are dropped', () => {
    expect(parseAddress('?route=BD-CN&view=everything&section=5')).toMatchObject({
      view: null,
      section: 5,
    });
    const last = routePackSections.at(-1)!.number;
    for (const bad of ['0', String(last + 1), '99', 'x', '-1', '5.5', ''])
      expect(parseAddress(`?route=BD-CN&section=${bad}`)).toMatchObject({
        section: null,
        sectionUnknown: true,
      });
    expect(parseAddress('?route=BD-CN').sectionUnknown).toBe(false);
    expect(parseAddress('?tab=x')).toMatchObject({ route: null, view: null, section: null });
  });

  test('a route key is looked up in the list, never guessed', () => {
    const routes = [
      { key: 'BD-CN', routeId: 'a' },
      { key: 'CN-BD', routeId: 'b' },
    ] as RouteSummary[];
    expect(routeIdOf('CN-BD', routes)).toBe('b');
    expect(routeIdOf('bd-cn', routes)).toBeNull();
    expect(routeIdOf('XX-YY', routes)).toBeNull();
  });
});

describe('what opens first', () => {
  test('To Do while a Core field is Pending or stale, otherwise All Sections', () => {
    expect(defaultView({ pending: 6, stale: 0 })).toBe('todo');
    expect(defaultView({ pending: 0, stale: 1 })).toBe('todo');
    expect(defaultView({ pending: 0, stale: 0 })).toBe('sections');
  });

  test('To Do lists the Pending Core fields and the stale Core facts by section, with a heading on the first of each section', () => {
    const completeness = deriveCompleteness(
      draft,
      documentOf([
        fact(firstContentCore.key, { observedOn: '2025-01-01', validUntil: '2025-06-01' }),
      ]),
      today,
    );
    const items = todoItems(completeness);
    expect(items.map((item) => item.row.key)).toEqual(
      expect.arrayContaining([...completeness.pendingCore, ...completeness.staleCore]),
    );
    expect(items).toHaveLength(completeness.pendingCore.length + completeness.staleCore.length);
    expect(todoCount(completeness)).toBe(items.length);
    const sections = items.map((item) => item.row.section);
    expect(sections).toEqual([...sections].sort((a, b) => a - b));
    // A heading exactly where the section changes.
    items.forEach((item, index) =>
      expect(item.heading !== null).toBe(index === 0 || sections[index - 1] !== sections[index]),
    );
    expect(items.every((item) => item.row.core)).toBe(true);
    // No optional field is listed.
    expect(items.some((item) => !item.row.core)).toBe(false);
  });

  test('with every Core field done and none stale, To Do is empty', () => {
    const facts = standardFieldsV1
      .filter((field) => field.part === 'Content' && field.core)
      .map((field) =>
        fact(field.key, { value: field.type === 'list' ? ['Item'] : 'Sample route fact' }),
      );
    const configuration: Partial<RouteConfiguration> = {
      missionTypes: ['sourcing'],
      languages: ['en'],
      currencies: ['USD'],
      timeZones: ['Etc/UTC'],
      channels: ['SYNTHETIC'],
    };
    const completeness = deriveCompleteness(
      { status: 'TESTING', configuration },
      documentOf(facts),
      today,
    );
    expect(completeness.pendingCore.length).toBe(0);
    expect(todoItems(completeness)).toEqual([]);
  });
});

describe('words come from the numbers given, never typed ones', () => {
  test('progress, list and stale words follow the total they are given', () => {
    for (const total of [20, 22, 7]) {
      expect(progressWords({ total, pending: 6 })).toBe(
        `Core fields: ${total - 6} of ${total} done. 6 still Pending.`,
      );
      expect(progressWords({ total, pending: 0 })).toBe(`Core fields: ${total} of ${total} done.`);
      expect(coreListWords({ total, pending: total })).toBe(`Core 0 of ${total} done`);
      expect(coreListWords({ total, pending: 0 })).toBe('Core complete');
    }
    expect(coreListWords({ total: 0, pending: 0 })).toBeNull();
    expect(staleListWords(2)).toBe('2 stale');
    expect(staleListWords(0)).toBeNull();
    expect(staleLine(1)).toBe('1 fact is stale. Check it before relying on it.');
    expect(staleLine(3)).toBe('3 facts are stale. Check them before relying on them.');
    expect(optionalLine(0)).toBeNull();
    expect(optionalLine(1)).toBe('1 optional field is still Pending. Open All Sections to see it.');
    expect(optionalLine(31)).toBe(
      '31 optional fields are still Pending. Open All Sections to see them.',
    );
  });

  test('the gaps line names the real status, singular and plural, and never says the route is cleared', () => {
    expect(gapsLine('Active', 3)).toBe(
      'This route is Active, and 3 Core fields are still Pending. It keeps working. Fill them when you can. This does not mean the route is cleared.',
    );
    expect(gapsLine('Limited use', 1)).toContain('1 Core field is still Pending');
    expect(gapsLine('Limited use', 1)).toContain('Fill it when you can.');
  });

  test('no count of today is typed into a helper: the Core total follows the standard', () => {
    const completeness = deriveCompleteness(draft, null, today);
    const total = completeness.fields.filter((row) => row.core).length;
    expect(total).toBe(coreKeysV1.length);
    expect(progressWords({ total, pending: completeness.pendingCore.length })).toContain(
      `0 of ${coreKeysV1.length} done`,
    );
  });

  test('readiness and the last pack change in words, from what the services say', () => {
    expect(readinessLine({ completeMissionTypes: [] }, 3)).toBe(
      'Readiness: not recorded for pack version 3.',
    );
    expect(readinessLine({ completeMissionTypes: ['supplier_discovery', 'sourcing'] }, 3)).toBe(
      'Readiness: complete for Supplier discovery, Sourcing on pack version 3.',
    );
    const base = { version: 3, reviewed: true };
    expect(
      packChangeLine(
        { ...base, proposedAndPublishedByYou: true, proposedAndPublishedBySame: true },
        '26 Nov 2026',
      ),
    ).toBe('Pack version 3, proposed and published by you, effective 26 Nov 2026');
    expect(
      packChangeLine(
        { ...base, proposedAndPublishedByYou: false, proposedAndPublishedBySame: true },
        '26 Nov 2026',
      ),
    ).toBe('Pack version 3, proposed and published by a teammate, effective 26 Nov 2026');
    expect(
      packChangeLine(
        { ...base, proposedAndPublishedByYou: false, proposedAndPublishedBySame: false },
        '26 Nov 2026',
      ),
    ).toBe(
      'Pack version 3, proposed by one team member, published by another, effective 26 Nov 2026',
    );
    expect(
      packChangeLine(
        {
          version: 3,
          reviewed: false,
          proposedAndPublishedByYou: false,
          proposedAndPublishedBySame: false,
        },
        '26 Nov 2026',
      ),
    ).toBe(
      'Pack version 3, effective 26 Nov 2026. This change did not go through review, so no proposer is recorded.',
    );
  });

  test('no em dash and no typed number reaches any helper sentence', () => {
    const sentences = [
      progressWords({ total: 9, pending: 4 }),
      gapsLine('Active', 2),
      staleLine(2),
      optionalLine(2) ?? '',
      readinessLine({ completeMissionTypes: [] }, 1),
    ];
    for (const sentence of sentences) expect(sentence).not.toContain(String.fromCharCode(0x2014));
  });
});

describe('what a field row shows', () => {
  test('money exactly as stored, a list as its items, text as text, nothing as empty', () => {
    expect(valueWords({ currency: 'USD', amountMinor: '4500' })).toEqual({
      kind: 'text',
      text: 'USD 45.00',
    });
    expect(valueWords({ currency: 'BDT', amountMinor: '12345678901' })).toEqual({
      kind: 'text',
      text: 'BDT 123456789.01',
    });
    expect(valueWords(['a', 'b'])).toEqual({ kind: 'list', items: ['a', 'b'] });
    expect(valueWords('words')).toEqual({ kind: 'text', text: 'words' });
    expect(valueWords(undefined)).toEqual({ kind: 'empty' });
    expect(valueWords([])).toEqual({ kind: 'empty' });
    expect(valueWords('   ')).toEqual({ kind: 'empty' });
  });

  test('a source is Staff knowledge, the host of an https address, or nothing', () => {
    expect(sourceWords('staff knowledge')).toBe('Staff knowledge');
    expect(sourceWords('https://example.org/register?x=1')).toBe('example.org');
    expect(sourceWords('http://example.org')).toBeNull();
    expect(sourceWords('javascript:alert(1)')).toBeNull();
    expect(sourceWords(undefined)).toBeNull();
  });

  test('a row takes its label from the dictionary, a custom label from the fact, and a pack setting its value from the pack', () => {
    const completeness = deriveCompleteness(
      { status: 'TESTING', configuration: { languages: ['en', 'bn'] } },
      documentOf([
        fact('custom.visit_season', {
          label: 'Best months for factory visits',
          section: 11,
          type: 'text',
        }),
      ]),
      today,
    );
    const facts = factsByKey(
      documentOf([
        fact('custom.visit_season', {
          label: 'Best months for factory visits',
          section: 11,
          type: 'text',
        }),
      ]),
    );
    const languages = standardFieldsV1.find((field) => field.configurationKey === 'languages')!;
    const row = completeness.fields.find((item) => item.key === languages.key)!;
    const view = fieldView(row, facts, { languages: ['en', 'bn'] }, {});
    expect(view).toMatchObject({
      label: standardFieldByKey.get(languages.key)!.label,
      locked: true,
      value: { kind: 'list', items: ['en', 'bn'] },
      source: null,
      observedOn: null,
    });
    const custom = completeness.fields.find((item) => item.custom)!;
    expect(fieldView(custom, facts, null, {})).toMatchObject({
      label: 'Best months for factory visits',
      custom: true,
      locked: false,
      source: 'Staff knowledge',
    });
  });

  test('a Not applicable fact keeps its reason', () => {
    const optional = standardFieldsV1.find((field) => field.part === 'Content' && !field.core)!;
    const document = documentOf([
      { key: optional.key, state: 'NOT_APPLICABLE', note: 'Does not apply here' } as ContentFact,
    ]);
    const completeness = deriveCompleteness(draft, document, today);
    const row = completeness.fields.find((item) => item.key === optional.key)!;
    expect(fieldView(row, factsByKey(document), null, {})).toMatchObject({
      state: 'NOT_APPLICABLE',
      note: 'Does not apply here',
    });
  });
});

describe('sections', () => {
  test('every section of the standard has one line, with its parts only where they are above zero', () => {
    const completeness = deriveCompleteness(draft, null, today);
    const lines = sectionLines(completeness);
    expect(lines.map((line) => line.number)).toEqual(routePackSections.map((s) => s.number));
    const withCore = lines.find((line) => line.corePending > 0)!;
    expect(sectionParts(withCore)[0]).toBe(`${withCore.corePending} Core pending`);
    expect(
      sectionParts({
        number: 1,
        name: 'x',
        state: 'FILLED',
        corePending: 0,
        stale: 0,
        optionalPending: 0,
      }),
    ).toEqual([]);
  });

  test('a section marked Not applicable that still holds a pack setting Core and Pending says which', () => {
    const marked = routePackSections.find((section) =>
      standardFieldsV1.some(
        (field) => field.section === section.number && field.part === 'Locked' && field.core,
      ),
    )!;
    const document = documentOf([], [{ section: marked.number, note: 'Not part of this route' }]);
    const completeness = deriveCompleteness(draft, document, today);
    const sentence = markedButOpen(completeness, document, marked.number, (key) => `Label ${key}`);
    expect(sentence).toMatch(
      /^This section is marked Not applicable, but Label .+ Core and still Pending\.$/,
    );
    expect(markedButOpen(completeness, null, marked.number, (key) => key)).toBeNull();
  });
});
