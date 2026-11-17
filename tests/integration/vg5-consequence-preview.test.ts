import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evidenceReplyFacts } from '../../apps/web/lib/consequence-preview';
import { privacyReaders } from '../../apps/web/lib/privacy-label';
import { catalogs, en, translate } from '../../apps/web/lib/i18n/messages';

// Visual grammar PR 5 (owner decision 17 November 2026, V3-05-033): a plain preview right before "Send response" on
// an evidence request. Step 1 is behaviour only: it informs, adds no control and leaves the request untouched. Every
// line it says is a fact the database enforces, and each fact is checked against the migration text here.
const web = createRequire(resolve('apps/web/package.json'));
const ce = web('react').createElement as (type: unknown, props?: unknown) => unknown;
const render = web('react-dom/server').renderToStaticMarkup as (element: unknown) => string;
const read = (path: string) => readFileSync(resolve(path), 'utf8');
const loadWeb = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
const dashes = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
const keys = Object.keys(en).filter((k) => k.startsWith('consequence.'));

describe('the preview only says what the database enforces', () => {
  it('has one source note per line, and each cited file holds the fact', () => {
    expect(evidenceReplyFacts.map((f) => f.body)).toEqual([
      'consequence.whatBody',
      'consequence.onceBody',
      'consequence.untilBody',
    ]);
    for (const fact of evidenceReplyFacts) expect(fact.sourceNote).toMatch(/\S+\.sql:\d+-\d+/);
    const respond = read('packages/db/migrations/0016_scoped_delivery.sql');
    // What is sent: the typed body is stored and recorded as a self-declaration.
    expect(respond).toMatch(
      /INSERT INTO app\.delivery_response\(id,tenant_id,request_id,link_id,body\) VALUES\(k,l\.tenant_id,rid,l\.id,b\)/,
    );
    expect(respond).toMatch(/RETURN jsonb_build_object\('id',k,'claimStatus','self_declared'\)/);
    // Once: a closed request and a different second response are both refused.
    expect(respond).toMatch(/RAISE EXCEPTION 'Request closed'/);
    expect(respond).toMatch(
      /s\.body<>b THEN RAISE EXCEPTION 'Response already recorded or retry changed'/,
    );
    // Until when: the link opens only before it expires and while no revocation names it (real-use definition).
    const links = read('packages/db/customer-real-use-migrations/0009_real_report_links.sql');
    expect(links).toMatch(/AND expires_at>now\(\);/);
    expect(links).toMatch(
      /EXISTS\(SELECT FROM app\.delivery_revocation WHERE tenant_id=l\.tenant_id AND link_id=l\.id\)/,
    );
    // The recorded response is read back by the link: it is part of the report's request list.
    expect(respond).toMatch(/'response',s\.body/);
  });
  it('names no reader the code does not confirm: the link holder is confirmed, the rest are Not stated', () => {
    expect(privacyReaders('evidenceReply').map((r) => [r.reader, r.status])).toEqual([
      ['privacy.reader.anyoneWithLink', 'confirmed'],
      ['privacy.reader.workspace', 'not_stated'],
      ['privacy.reader.corridra', 'not_stated'],
    ]);
  });
  it('promises no window the code does not enforce', () => {
    expect(en['consequence.untilBody']).toMatch(/at most until the link expires or is withdrawn/);
    for (const key of keys) expect(translate('en', key as never)).not.toMatch(/hour|day|week/i);
  });
});

describe('the words', () => {
  it('has every line in all seven languages, each draft its own', () => {
    expect(Object.keys(catalogs).sort()).toEqual(['ar', 'bn', 'de', 'en', 'es', 'fr', 'zh']);
    expect(keys.length).toBe(7);
    for (const [code, catalog] of Object.entries(catalogs))
      for (const key of keys) {
        const word = (catalog as Record<string, string>)[key];
        expect(word, `${code} ${key}`).toBeTruthy();
        if (code !== 'en') expect(word, `${code} ${key}`).not.toBe(en[key as keyof typeof en]);
      }
  });
  it('contains no em or en dash in any language', () => {
    for (const catalog of Object.values(catalogs))
      for (const key of keys) expect((catalog as Record<string, string>)[key]).not.toMatch(dashes);
  });
});

describe('the preview as drawn', () => {
  it('shows who can see it, what is sent and until when, with no control, in English', async () => {
    const { ConsequencePreview } = await loadWeb('components/consequence-preview.tsx');
    const html = render(ce(ConsequencePreview, { expires: '17 Dec 2026, 09:00' }));
    for (const key of [
      'privacy.heading',
      'privacy.reader.anyoneWithLink',
      'privacy.canSee',
      'consequence.heading',
      'consequence.what',
      'consequence.whatBody',
      'consequence.once',
      'consequence.onceBody',
      'consequence.until',
      'consequence.untilBody',
    ])
      expect(html, key).toContain(translate('en', key as never));
    expect(html).toContain('17 Dec 2026, 09:00');
    expect(html).toMatch(/lang="en"/);
    expect(html).not.toMatch(/<(button|input|select|textarea|a)\b|tabindex|onclick|style=/i);
    // Every word is plain text on the page: nothing is held back for a hover.
    expect(html).not.toMatch(/title=/);
  });
  it('reads right to left in Arabic and sets its own language, for the label and the preview', async () => {
    const { ConsequencePreview } = await loadWeb('components/consequence-preview.tsx');
    const html = render(ce(ConsequencePreview, { expires: '17 Dec 2026', locale: 'ar' }));
    expect(html.match(/dir="rtl"/g)).toHaveLength(2);
    expect(html.match(/lang="ar"/g)).toHaveLength(2);
    expect(html).toContain(translate('ar', 'consequence.heading' as never));
    expect(html).toContain(translate('ar', 'privacy.heading' as never));
    expect(html).not.toContain(translate('en', 'consequence.heading' as never));
  });
});

describe('the Send request is untouched', () => {
  it('keeps the one post() body and the respond call exactly as they were', () => {
    const view = read('apps/web/app/delivery-view.tsx');
    expect(view).toContain('body: JSON.stringify({ ...input, audience, token: token.current }),');
    expect(view).toContain("await post({ action: 'respond', ...request });");
    expect(view).toContain(
      `    const request = pendingResponse ?? {
      requestId,
      body,
      acknowledged: data.get('acknowledged') === 'on',
      commandId: command(key),
    };`,
    );
    // The preview is one added line inside the form, before the button, outside the disabled fieldset.
    expect(view).toMatch(
      /<\/fieldset>\s*<ConsequencePreview expires=\{formatMoment\(report\.expiresAt\)\} \/>\s*<button/,
    );
  });
});
