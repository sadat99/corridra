import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Room stage variant (Wave 2 unit 05): `variant="room"` adds the stage heading, a shape and word per stage and
// the Done and Later lines from the same marker and records; left out, the markup is the one every other screen draws.
const web = createRequire(resolve('apps/web/package.json'));
const createElement = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...children: unknown[]
) => unknown;
const render = web('react-dom/server').renderToStaticMarkup as (element: unknown) => string;
const load = async () =>
  await import(/* @vite-ignore */ '../../apps/web/components/mr/stage-bar.tsx');
const text = (html: string) => html.replace(/<[^>]+>/g, '');

describe('StageBar room variant', () => {
  it('draws the same markup as before when no variant is given', async () => {
    const { StageBar } = await load();
    const html = render(createElement(StageBar, { status: 'MEETINGS' }));
    expect(html).not.toContain('data-variant');
    expect(html).not.toContain('mr-stage-shape');
    expect(html).not.toContain('mr-stage-heading');
    expect(html.match(/<li /g)).toHaveLength(6);
    expect(html).toContain('<p class="mr-stage-line">Stage: <b>Visit</b></p>');
  });

  it('adds the step heading and the Done, Later and Not tracked yet lines from the marker and records', async () => {
    const { StageBar } = await load();
    const html = render(
      createElement(StageBar, {
        status: 'ACTIVE',
        variant: 'room',
        records: { compare: false, decide: false },
      }),
    );
    expect(html).toContain('data-variant="room"');
    expect(text(html)).toContain('Step 2 of 6: Find');
    expect(text(html)).toContain('Done: Define');
    expect(text(html)).toContain('Later: Visit, Follow through');
    expect(text(html)).toContain('Not tracked yet: Compare, Decide');
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toContain('Find, Now');
    expect(html).toContain('Define, Done');
  });

  it('never shows an untracked stage as done or later, and omits an empty line', async () => {
    const { StageBar } = await load();
    const html = render(
      createElement(StageBar, {
        status: 'FOLLOW_UP',
        variant: 'room',
        records: { compare: true, decide: false },
      }),
    );
    expect(text(html)).toContain('Not tracked yet: Decide');
    expect(text(html)).not.toMatch(/Later:/);
    expect(html).toMatch(/data-state="grey" data-shape="notTracked"/);
  });

  it('keeps the aside sentence and no step heading for a paused, cancelled or unknown request', async () => {
    const { StageBar } = await load();
    for (const status of ['ON_HOLD', 'CANCELLED', 'SOMETHING_NEW']) {
      const html = render(createElement(StageBar, { status, variant: 'room' }));
      expect(html).not.toContain('mr-stage-heading');
      expect(html).not.toContain('aria-current');
      expect(html).toContain('mr-stage-line');
    }
  });

  it('marks the step words with the given language', async () => {
    const { StageBar } = await load();
    const html = render(
      createElement(StageBar, { status: 'ACTIVE', variant: 'room', stepLang: 'en' }),
    );
    expect(html).toContain('<span lang="en">Step 2 of 6:</span>');
  });
});
