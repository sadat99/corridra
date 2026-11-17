import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  privacyReaders,
  privacySurfaces,
  type PrivacySurface,
} from '../../apps/web/lib/privacy-label';
import { catalogs, en, translate } from '../../apps/web/lib/i18n/messages';

// PL1 (owner, 17 Nov 2026, "Two steps (Recommended)", step 1): a plain "Who can see it" block on customer share and
// send surfaces, built only from facts the code or database already determines. It only informs: no share, send or
// link control is blocked, delayed, disabled or given an extra step. A reader with no confirmed source says "Not stated".
const web = createRequire(resolve('apps/web/package.json'));
const ce = web('react').createElement as (type: unknown, props?: unknown) => unknown;
const render = web('react-dom/server').renderToStaticMarkup as (element: unknown) => string;
const read = (path: string) => readFileSync(resolve(path), 'utf8');
const loadWeb = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);

/** Every interactive control in rendered markup: tag, attributes and its own text. */
const controls = (html: string) =>
  [...html.matchAll(/<(button|input|select|textarea|a)\b([^>]*)>([^<]*)/g)].map(
    (m) => `${m[1]}|${m[2].replace(/\s+/g, ' ').trim()}|${m[3]}`,
  );
/** The label's own markup, cut out of a rendered surface. */
const labelOf = (html: string) =>
  /<div class="privacy-label"[\s\S]*?<\/ul><\/div>/.exec(html)?.[0] ?? '';

const expected: Record<PrivacySurface, [string, 'confirmed' | 'not_stated'][]> = {
  decisionCard: [
    ['privacy.reader.anyoneWithLink', 'confirmed'],
    ['privacy.reader.youMadeLink', 'confirmed'],
    ['privacy.reader.workspace', 'not_stated'],
    ['privacy.reader.corridra', 'not_stated'],
  ],
  savedReport: [
    ['privacy.reader.youSaved', 'confirmed'],
    ['privacy.reader.anyoneWithReportLink', 'confirmed'],
    ['privacy.reader.workspace', 'not_stated'],
    ['privacy.reader.corridra', 'not_stated'],
  ],
  recipientReply: [
    ['privacy.reader.anyoneWithReplyLink', 'confirmed'],
    ['privacy.reader.sendingTeam', 'confirmed'],
    ['privacy.reader.requester', 'not_stated'],
  ],
};

describe('who can see it: the readers come only from confirmed code facts', () => {
  it('names exactly the three customer share and send surfaces', () => {
    expect([...privacySurfaces]).toEqual(['decisionCard', 'savedReport', 'recipientReply']);
  });
  for (const surface of Object.keys(expected) as PrivacySurface[]) {
    it(`${surface}: returns exactly the confirmed and unstated readers, in order`, () => {
      expect(privacyReaders(surface).map((r) => [r.reader, r.status])).toEqual(expected[surface]);
    });
    it(`${surface}: no reader is confirmed without a source, and an unstated one cites none`, () => {
      for (const row of privacyReaders(surface)) {
        if (row.status === 'confirmed') expect(row.sourceNote).toMatch(/\S+\.(sql|ts):\S+/);
        else expect(row.sourceNote).toBeNull();
      }
    });
  }
  it('every cited source exists and still holds the fact it names', () => {
    const facts: [string, RegExp][] = [
      // Anyone holding the decision card link reads it by the hash of its secret, for at most 168 hours.
      [
        'packages/db/customer-decision-card-migrations/0001_decision_cards.sql',
        /CREATE FUNCTION app\.read_decision_card\(h text\)[\s\S]*?WHERE token_hash=h/,
      ],
      [
        'packages/db/customer-decision-card-migrations/0001_decision_cards.sql',
        /interval '168 hours'/,
      ],
      // The creator's own cards: listed and withdrawn only where principal_id is the actor.
      [
        'packages/db/customer-decision-card-migrations/0001_decision_cards.sql',
        /FROM customer_private\.decision_card d WHERE d\.saved_mission_id=resource AND d\.principal_id=actor/,
      ],
      // A saved report is read by the principal who saved it, through the original link's token.
      [
        'packages/db/customer-commercial-migrations/0001_saved_mission_invitations.sql',
        /WHERE id=resource AND principal_id=actor AND removed_at IS NULL FOR SHARE;\s*\n[^\n]*\n\s*l:=app\.delivery_authorized\(saved\.token_hash,'CLIENT_PROGRESS'\)/,
      ],
      [
        'packages/db/migrations/0016_scoped_delivery.sql',
        /CREATE FUNCTION app\.delivery_authorized\(h text,audience text\)[\s\S]*?WHERE token_hash=h/,
      ],
      // The private reply link reads the recorded reply back.
      [
        'packages/db/migrations/0025_scoped_product_experience.sql',
        /CREATE FUNCTION app\.recipient_detail_view\(h text\)[\s\S]*?'detailResponse'/,
      ],
      // The sending workspace's members read replies (classification and purpose), and its owner or admin reviews.
      [
        'packages/db/migrations/0025_scoped_product_experience.sql',
        /recipient_detail_response' THEN ' AND app\.buyer_link_access\(tenant_id,link_id\) AND retention_until>now\(\)'/,
      ],
      [
        'packages/db/recipient-reply-review-migrations/0001_reply_review.sql',
        /viewer NOT IN \('owner','admin'\)/,
      ],
      // The existing page words already tell the person the team reviews the reply.
      [
        'apps/web/app/buyer/recipient-response.tsx',
        /I understand that the operator will review it\./,
      ],
      ['apps/web/lib/reply-words.ts', /The team will review it\./],
    ];
    for (const [path, fact] of facts) expect(read(path), path).toMatch(fact);
  });
});

describe('the words', () => {
  const keys = Object.keys(en).filter((k) => k.startsWith('privacy.'));
  it('says Not stated through the catalogue, in all seven languages', () => {
    expect(translate('en', 'privacy.notStated' as never)).toBe('Not stated');
    expect(translate('en', 'privacy.heading' as never)).toBe('Who can see it');
    expect(Object.keys(catalogs).sort()).toEqual(['ar', 'bn', 'de', 'en', 'es', 'fr', 'zh']);
    for (const [code, catalog] of Object.entries(catalogs))
      for (const key of keys)
        expect((catalog as Record<string, string>)[key], `${code} ${key}`).toBeTruthy();
  });
  it('shows no unreviewed translation: every other language carries the English draft placeholder', () => {
    for (const catalog of Object.values(catalogs))
      for (const key of keys)
        expect((catalog as Record<string, string>)[key]).toBe((en as Record<string, string>)[key]);
  });
  it('has a word for every reader the lib can return', () => {
    for (const surface of privacySurfaces)
      for (const row of privacyReaders(surface)) expect(keys).toContain(row.reader);
  });
});

describe('the label as drawn', () => {
  it('is a plain group: the heading, each reader with its word, no control and no colour-only meaning', async () => {
    const { PrivacyLabel } = await loadWeb('components/privacy-label.tsx');
    for (const surface of privacySurfaces) {
      const html = render(ce(PrivacyLabel, { surface }));
      expect(html).toContain('Who can see it');
      expect(html).toMatch(/role="group"/);
      expect(html).toMatch(/lang="en"/);
      for (const row of privacyReaders(surface)) {
        expect(html).toContain(translate('en', row.reader as never));
        expect(html).toContain(
          `class="privacy-label-status" data-status="${row.status}">${row.status === 'confirmed' ? 'Can see it' : 'Not stated'}<`,
        );
      }
      expect(controls(html)).toEqual([]);
      expect(html).not.toMatch(/tabindex|onclick|style=/i);
    }
  });
});

const panel = {
  phase: 'ready',
  chosen: 'd1',
  acknowledged: true,
  busy: false,
  preview: {
    fields: {
      company: 'A',
      decision: 'SELECT',
      rationale: 'r',
      nextAction: 'n',
      dueAt: '2026-12-01T00:00:00.000Z',
      provenance: { sourceKind: 'self_declaration', claimStatus: 'self_declared' },
    },
    expiresAt: '2026-12-01T00:00:00.000Z',
  },
  link: 'https://x/c#t',
  linkExpiresAt: '2026-12-01T00:00:00.000Z',
  cards: [
    {
      id: 'c1',
      state: 'ACTIVE',
      expiresAt: '2026-12-01T00:00:00.000Z',
      opens: 1,
      lastOpenedAt: null,
    },
  ],
  notice: null,
  maxActive: 5,
};
const decisions = [{ id: 'd1', company: 'A', decision: 'SELECT', requirementCurrent: true }];

describe('on each surface, the label informs and changes no control', () => {
  it('decision card: shown with the preview and with the link, and the controls are exactly those on main', async () => {
    const { DecisionCardPanelView } = await loadWeb('app/account/missions/decision-card-panel.tsx');
    const html = render(ce(DecisionCardPanelView, { panel, decisions }));
    expect(html.match(/class="privacy-label"/g)?.length).toBe(1);
    expect(labelOf(html)).toContain('Anyone with the link');
    // The control set on origin/main e317165, read with the same extractor before this change.
    expect(controls(html)).toEqual([
      'input|type="radio" name="decision-card-choice" checked="" value="d1"/|',
      'button|type="button" class="decision-card-action"|Preview',
      'input|type="checkbox" checked=""/|',
      'button|type="button" class="decision-card-action"|Create Link',
      'input|type="text" readOnly="" aria-label="Decision card link" value="https://x/c#t"/|',
      'button|type="button" class="decision-card-action"|Copy Link',
      'button|type="button" class="decision-card-action"|Withdraw',
    ]);
    // Before any preview (the first step), the label is there too, and Preview is the only action, as before.
    const first = render(
      ce(DecisionCardPanelView, {
        panel: { ...panel, preview: null, link: null, cards: [] },
        decisions,
      }),
    );
    expect(first).toContain('class="privacy-label"');
    expect(controls(first).filter((c) => c.startsWith('button'))).toEqual([
      'button|type="button" class="decision-card-action"|Preview',
    ]);
    // A real workspace and a not-ready panel keep drawing exactly what they drew.
    expect(render(ce(DecisionCardPanelView, { real: true }))).not.toContain('privacy-label');
    expect(render(ce(DecisionCardPanelView, {}))).toBe('');
  });
  it('recipient reply (older form): shown above the send, and the controls are exactly those on main', async () => {
    const { RecipientResponse } = await loadWeb('app/buyer/recipient-response.tsx');
    const html = render(
      ce(RecipientResponse, { token: 't', allowQuotation: true, allowMeetingInterest: true }),
    );
    expect(labelOf(html)).toContain('The team that sent you this request');
    expect(controls(html)).toEqual([
      'textarea|name="body" minLength="3" maxLength="1000" required=""|',
      'input|type="checkbox" name="meetingInterest"/|I would like to discuss a meeting or visit. This is interest, not a confirmed appointment.',
      'input|type="checkbox"/|Include a supplier-declared quotation',
      'input|type="checkbox" required="" name="acknowledged"/|This is my declaration for this request. I understand that the operator will review it.',
      'button|class="primary-link"|Record Response',
    ]);
    // The label sits outside the form's fieldset, so it can never be disabled with it or hold the send.
    expect(html.indexOf('privacy-label')).toBeLessThan(html.indexOf('<fieldset'));
  });
  it('reply journey and saved report: placed beside the existing send and report words, handlers untouched', () => {
    const journey = read('apps/web/app/buyer/reply-journey.tsx');
    expect(journey).toMatch(
      /<PrivacyLabel surface="recipientReply" \/>\s*<h3>\{words\.checkYourAnswer\}<\/h3>/,
    );
    expect(journey).toContain(
      '<form onSubmit={(event) => void send(event)} noValidate aria-labelledby="reply-h">',
    );
    expect(journey).toContain('<button className="primary-link" disabled={sending || !!latest}>');
    const report = read('apps/web/app/account/missions/saved-commercial-report.tsx');
    expect(report).toMatch(
      /Original access expires \{formatMoment\(data\.expiresAt\)\}\s*\.\s*<\/p>\s*<PrivacyLabel surface="savedReport" \/>/,
    );
    // The evidence reply is VG5's later unit and is not touched here.
    expect(read('apps/web/app/delivery-view.tsx')).not.toContain('PrivacyLabel');
  });
});
