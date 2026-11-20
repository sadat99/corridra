import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  beforeSendRows,
  evidenceReplyFacts,
  oneResponseFact,
} from '../../apps/web/lib/consequence-preview';
import { privacyReaders } from '../../apps/web/lib/privacy-label';
import { catalogs, en, translate } from '../../apps/web/lib/i18n/messages';
import { switchRegistry } from '../../apps/web/lib/owner-switches';
import { uxSwitchNames, uxSwitchOn } from '../../apps/web/lib/ux-switches';
import { iconPaths } from '../../apps/web/components/corridra-icon';

// Wave 3 unit 09 (owner approved 20 November 2026): the Before Send block above each Send. Presentation only: every
// row and sentence has a code fact behind it, the switch is off by default and, off, the pages are what they were.
const web = createRequire(resolve('apps/web/package.json'));
const ce = web('react').createElement as (type: unknown, props?: unknown) => unknown;
const render = web('react-dom/server').renderToStaticMarkup as (element: unknown) => string;
const read = (path: string) => readFileSync(resolve(path), 'utf8');
const loadWeb = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
const dashes = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
const newKeys = ['consequence.whatSent', 'consequence.oneResponse', 'beforeSend.tick'] as const;

describe('every row and sentence has a code fact behind it', () => {
  it('gives each row on each surface a source note, and the readers theirs', () => {
    for (const [surface, rows] of Object.entries(beforeSendRows)) {
      expect(
        rows.map((r) => r.id),
        surface,
      ).toEqual(['who', 'sent', 'until']);
      for (const row of rows)
        expect(row.sourceNote.length, `${surface} ${row.id}`).toBeGreaterThan(20);
      expect(rows.map((r) => r.icon)).toEqual(['people', 'document', 'clock']);
    }
    for (const surface of ['evidenceReply', 'recipientReply'] as const)
      for (const reader of privacyReaders(surface))
        if (reader.status === 'confirmed') expect(reader.sourceNote, reader.reader).toBeTruthy();
    expect(beforeSendRows.evidenceReply[1].sourceNote).toBe(evidenceReplyFacts[0].sourceNote);
    expect(beforeSendRows.evidenceReply[2].sourceNote).toBe(evidenceReplyFacts[1].sourceNote);
    expect(oneResponseFact.sourceNote).toBe(evidenceReplyFacts[0].sourceNote);
  });
  it('shows the one-response sentence on the evidence reply only', () => {
    expect(oneResponseFact.surface).toBe('evidenceReply');
    expect(en['consequence.oneResponse']).toBe(
      'One response is kept for each request, and a different one cannot be sent afterwards.',
    );
  });
});

describe('the words', () => {
  it('has the three new lines in all seven languages, each its own, with no dash', () => {
    for (const [code, catalog] of Object.entries(catalogs))
      for (const key of newKeys) {
        const word = (catalog as Record<string, string>)[key];
        expect(word, `${code} ${key}`).toBeTruthy();
        expect(word).not.toMatch(dashes);
        if (code !== 'en') expect(word, `${code} ${key}`).not.toBe(en[key]);
      }
  });
  it('splits the existing sentence without rewording it, so every translation is reused', () => {
    for (const [code, catalog] of Object.entries(catalogs) as [string, Record<string, string>][]) {
      const joined = [catalog['consequence.whatSent'], catalog['consequence.oneResponse']];
      expect([joined.join(' '), joined.join('')], code).toContain(catalog['consequence.whatBody']);
    }
  });
  it('says one message for a missing tick, and the older reply words stay as they were', () => {
    expect(en['beforeSend.tick']).toBe('Tick this box to send.');
    expect(read('apps/web/lib/reply-words.ts')).toContain(
      "notAcknowledged: 'Tick the box to confirm.'",
    );
  });
});

describe('the block as drawn', () => {
  it('draws three rows and the lock sentence for the evidence reply, with no control', async () => {
    const { BeforeSend } = await loadWeb('components/before-send.tsx');
    const html = render(
      ce(BeforeSend, { surface: 'evidenceReply', expires: '17 Dec 2026, 09:00' }),
    );
    for (const key of [
      'privacy.heading',
      'consequence.what',
      'consequence.until',
      'consequence.whatSent',
      'consequence.untilBody',
      'consequence.oneResponse',
      'privacy.reader.anyoneWithThisLink',
      'privacy.reader.sendingTeam',
    ])
      expect(html, key).toContain(translate('en', key as never));
    expect(html).toContain('17 Dec 2026, 09:00');
    expect(html.match(/class="before-send-row"/g)).toHaveLength(3);
    expect(html).toContain('before-send-once');
    expect(html).not.toMatch(/<(button|input|select|textarea|a)\b|tabindex|onclick|style=/i);
  });
  it('draws the three readers on the reply, no one-response sentence and no withdrawal claim', async () => {
    const { BeforeSend } = await loadWeb('components/before-send.tsx');
    const html = render(
      ce(BeforeSend, {
        surface: 'recipientReply',
        sent: 'Recorded as your own declaration. The team will review it.',
        until: 'This private link expires 17 Dec 2026.',
      }),
    );
    expect(html.match(/class="before-send-row"/g)).toHaveLength(3);
    expect(html).toContain(translate('en', 'privacy.reader.requester'));
    expect(html).toContain(translate('en', 'privacy.notStated'));
    expect(html).not.toContain(translate('en', 'consequence.oneResponse'));
    expect(html).not.toContain('before-send-once');
    expect(html).not.toMatch(/withdraw/i);
    expect(html).toContain('This private link expires 17 Dec 2026.');
  });
  it('reads right to left in Arabic and sets its own language', async () => {
    const { BeforeSend } = await loadWeb('components/before-send.tsx');
    const html = render(
      ce(BeforeSend, { surface: 'evidenceReply', expires: '17 Dec 2026', locale: 'ar' }),
    );
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="ar"');
    expect(html).toContain(translate('ar', 'consequence.oneResponse'));
  });
});

describe('the alert icon and the switch', () => {
  it('adds an alert icon that is a circle with an exclamation, not a triangle', () => {
    expect(iconPaths.alert).toMatch(/^M10 3\.5a6\.5 6\.5 0 1 0 0 13/);
    expect(iconPaths.alert).not.toMatch(/L|l\d+ -?\d+l/);
  });
  it('registers CORRIDRA_UX_BEFORE_SEND, described, off unless exactly true', () => {
    expect(uxSwitchNames).toContain('CORRIDRA_UX_BEFORE_SEND');
    const entry = switchRegistry.find((e) => e.name === 'CORRIDRA_UX_BEFORE_SEND');
    expect(entry?.line).toMatch(/Off by default/);
    expect(entry?.kind).toBe('flag');
    expect(uxSwitchOn('CORRIDRA_UX_BEFORE_SEND', {})).toBe(false);
    expect(uxSwitchOn('CORRIDRA_UX_BEFORE_SEND', { CORRIDRA_UX_BEFORE_SEND: '1' })).toBe(false);
    expect(uxSwitchOn('CORRIDRA_UX_BEFORE_SEND', { CORRIDRA_UX_BEFORE_SEND: 'true' })).toBe(true);
  });
  it('keeps today output with the switch off: the old preview, the native tick and the old words', () => {
    const view = read('apps/web/app/delivery-view.tsx');
    expect(view).toContain('beforeSend = false,');
    expect(view).toContain('const firstOpenMission = beforeSend\n    ? -1');
    expect(view).toContain('required={!beforeSend}');
    expect(view).toContain('{beforeSend && (');
    const journey = read('apps/web/app/buyer/reply-journey.tsx');
    expect(journey).toContain('omitted: beforeSend');
    expect(journey).toContain(
      "beforeSend ? translate(language, 'beforeSend.tick') : words.notAcknowledged",
    );
    for (const page of ['client/page', 'programme/page', 'buyer/page', 'account/page'])
      expect(read(`apps/web/app/${page}.tsx`)).toContain("uxSwitchOn('CORRIDRA_UX_BEFORE_SEND')");
  });
});
