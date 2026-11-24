import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// UI/UX.v4.1 wave V4.1-C, recipient links: /buyer, /client, /programme, /decision-card and the two mute pages.
// Checked without a browser or a database. L8 (private link unavailable) lives on /buyer: a warning edge, a lock
// beside the one shared refusal line, one retry, and the help links the page already had. A place name carries its
// mark (L1) through the shared flag component and only the nine existing flags. Nothing a private link shows is
// widened, and every refusal keeps its words.
const web = createRequire(resolve('apps/web/package.json'));
const ce = web('react').createElement as (
  type: unknown,
  props?: unknown,
  ...children: unknown[]
) => unknown;
const render = web('react-dom/server').renderToStaticMarkup as (element: unknown) => string;
const read = (path: string) => readFileSync(resolve(path), 'utf8');
const loadWeb = async (path: string) => await import(/* @vite-ignore */ `../../apps/web/${path}`);
const dashes = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
const gone =
  'This private link has expired or was replaced. Ask the person who sent it for a new link.';

describe('L1 on the private introduction', () => {
  it('the private introduction keeps its Country row as it was: its mark waits for a later unit', () => {
    // The Reply Page markup with its switch off is held by golden files (tests/integration/fixtures/buyer-steps-off),
    // and four existing browser harnesses bundle this page without the flag pictures. Both stay untouched here, so
    // the row is unchanged and the ledger says L1 is not started on /buyer.
    const intro = read('apps/web/app/buyer/introduction.tsx');
    const journey = read('apps/web/app/buyer/reply-journey.tsx');
    expect(intro).not.toContain('Flagged');
    expect(journey).not.toContain('Flagged');
    expect(intro.match(/\['Country', data\.introduction\.country\]/g)).toHaveLength(1);
    expect(journey.match(/\['Country', data\.introduction\.country\]/g)).toHaveLength(2);
  });
});

describe('L8: a private introduction link that does not open', () => {
  it('shows a lock beside the given line in one live region, and nothing else', async () => {
    const { LinkStatus } = await loadWeb('app/buyer/link-status');
    const { iconPaths } = await loadWeb('components/corridra-icon');
    const shut = render(ce(LinkStatus, { message: gone, unavailable: true }));
    expect(shut).toMatch(/^<p role="status" aria-live="polite" class="link-unavailable">/);
    expect(shut).toContain(iconPaths.lock);
    expect(shut).toContain('aria-hidden="true"');
    expect(shut.endsWith(`${gone}</p>`)).toBe(true);
    expect(shut.match(/<svg/g)).toHaveLength(1);
    // Any other state is the plain line it always was.
    expect(
      render(ce(LinkStatus, { message: 'Loading your introduction…', unavailable: false })),
    ).toBe('<p role="status" aria-live="polite">Loading your introduction…</p>');
  });

  it('the page keeps the one shared refusal line, one retry and its help links', () => {
    const intro = read('apps/web/app/buyer/introduction.tsx');
    const flat = intro.replace(/\s+/g, ' ');
    expect(flat).toContain('const unavailable = !data && message === gone;');
    expect(flat).toContain("data-link-state={unavailable ? 'unavailable' : undefined}");
    expect(flat).toContain('<LinkStatus message={message} unavailable={unavailable} />');
    // One retry, the primary action only when the link is unavailable; its words are the live words.
    expect(intro.match(/Retry Private Introduction/g)).toHaveLength(1);
    expect(flat).toContain("className={unavailable ? 'primary-link' : 'text-link'}");
    // D-053 holds: the words come from the one shared line, and no wording of this page's own was added.
    expect(intro).toMatch(/import \{ linkGone \} from '\.\.\/delivery-view';/);
    for (const invented of [
      'This private link is unavailable',
      'cut off in your email',
      'We cannot say more',
    ])
      expect(intro).not.toContain(invented);
    const page = read('apps/web/app/buyer/page.tsx');
    expect(page.match(/<AccessOptions \{\.\.\.accessHelp\.buyer\} \/>/g)).toHaveLength(1);
  });

  it('the unavailable state is told from the refusal line alone and reads nothing about the introduction', () => {
    const status = read('apps/web/app/buyer/link-status.tsx');
    expect(status).not.toMatch(/introduction|company|capability|workspace|requestId|token/i);
    expect(status).not.toMatch(dashes);
    const stop = read('apps/web/app/buyer/stop-emails.tsx').replace(/\s+/g, ' ');
    // The opt-out page marks its "link does not open" state the same way, with one retry and one help link.
    expect(stop).toContain("const shut = !usable || state === 'gone';");
    expect(stop).toContain('<LinkStatus message={message} unavailable={shut} />');
    expect(stop).toContain('const help = accessHelp.buyer.links[0];');
    expect(stop).toMatch(
      /\{shut && \( <> <button className="primary-link" onClick=\{\(\) => window\.location\.reload\(\)\}> Try Again <\/button> <a className="text-link" href=\{help\.href\}> \{help\.text\} <\/a> <\/> \)\}/,
    );
    // Two buttons in the source, never both at once: the opt-out button is not drawn when the link is shut, and
    // the retry only loads the page again. Only the opt-out button reaches the server.
    expect(stop.match(/<button/g)).toHaveLength(2);
    expect(stop).toContain("{usable && state !== 'done' && state !== 'gone' && (");
    expect(stop.match(/fetch\(/g)).toHaveLength(1);
    expect(stop).toContain("fetch('/api/outreach/unsubscribe'");
  });

  it('the edge and the lock are drawn with tokens only', () => {
    const css = read('apps/web/app/buyer/link-status.css');
    expect(css).toContain("[data-link-state='unavailable']");
    expect(css).toMatch(/border-inline-start:\s*4px solid var\(--caution\)/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(|gradient|backdrop-filter|box-shadow/);
    expect(css).not.toMatch(dashes);
  });
});

describe('owner words: a recipient never reads a staff role name', () => {
  it('the four lines that named the operator now name the Corridra team, and nothing else moved', () => {
    const claim = 'Corridra team-reported context. No independent verification is asserted.';
    expect(read('apps/web/app/buyer/introduction.tsx').split(claim)).toHaveLength(2);
    expect(read('apps/web/app/buyer/reply-journey.tsx').split(claim)).toHaveLength(2);
    const response = read('apps/web/app/buyer/recipient-response.tsx').replace(/\s+/g, ' ');
    expect(response).toContain(
      '{saved.sourceKind}. The Corridra team must review this declaration. No meeting, quotation approval or verification is inferred.',
    );
    expect(response).toContain(
      "'This is my declaration for this request. I understand that the Corridra team will review it.'",
    );
    // The declaration is still one required checkbox named as before: only the box is sent, never its words.
    expect(response).toContain('name="acknowledged"');
    for (const file of ['introduction', 'reply-journey', 'recipient-response', 'stop-emails'])
      expect(read(`apps/web/app/buyer/${file}.tsx`), file).not.toMatch(/\boperators?\b/i);
  });
});

describe('the report pages keep one date form', () => {
  it('a meeting time on a shared report is written by the product date formatter in the meeting time zone', () => {
    const view = read('apps/web/app/delivery-view.tsx');
    expect(view).not.toContain('toLocaleString(');
    expect(view.replace(/\s+/g, ' ')).toContain(
      'formatDateTime(mt.startsAt, { timeZone: mt.timezone })',
    );
    // The refusal line of the client and programme pages is the shared one, unchanged.
    expect(view.replace(/\s+/g, ' ')).toContain(`export const linkGone = '${gone}';`);
  });

  it('writes the time as the formatter does, with the place and offset of the meeting zone', async () => {
    const { formatDateTime } = await loadWeb('lib/ux/format');
    expect(formatDateTime('2026-03-12T01:00:00.000Z', { timeZone: 'Asia/Shanghai' })).toBe(
      '12 Mar 2026, 09:00 (Shanghai, UTC+8)',
    );
  });
});

describe('the shared decision and the mute pages are unchanged and leak nothing', () => {
  it('a decision link that does not open still shows one line and no card field', async () => {
    const { DecisionCardPage } = await loadWeb('app/decision-card/decision-card-page');
    const { unavailableWords } = await loadWeb('lib/decision-card-page');
    const html = render(ce(DecisionCardPage, { state: { kind: 'unavailable' } }));
    expect(html).toBe(
      `<main id="main" class="decision-card" lang="en"><h1>${unavailableWords}</h1></main>`,
    );
  });

  it('both mute pages keep their words, their button and their two refusals', () => {
    for (const file of [
      'apps/web/app/mute/[requestId]/mute-form.tsx',
      'apps/web/app/pulse/mute/[requestId]/mute-form.tsx',
    ]) {
      const form = read(file).replace(/\s+/g, ' ');
      expect(form).toContain('Mute Messages About This Request');
      expect(form).toContain('This link is not valid or has expired.');
      expect(form).toContain('This link is incomplete. Open it from the email we sent you');
      expect(form.match(/<button/g)).toHaveLength(1);
    }
  });
});

describe('the conformance ledger rows of the recipient routes', () => {
  const ledger = JSON.parse(read('docs/revamp/v4-1-conformance.json')) as {
    routes: {
      route: string;
      decisions: Record<string, string>;
      evidence: string[];
      notes: string;
    }[];
  };
  const row = (route: string) => ledger.routes.find((r) => r.route === route)!;
  it('are assessed, and /buyer carries L8 as built with evidence and L1 as not started', () => {
    for (const route of [
      '/buyer',
      '/client',
      '/programme',
      '/decision-card',
      '/mute/[requestId]',
      '/pulse/mute/[requestId]',
    ]) {
      expect(Object.values(row(route).decisions), route).not.toContain('not_assessed');
      expect(row(route).notes, route).not.toBe('');
      expect(row(route).notes, route).not.toMatch(dashes);
    }
    expect(row('/buyer').decisions.L8).toBe('built');
    expect(row('/buyer').decisions.L1).toBe('not_started');
    expect(row('/buyer').evidence.length).toBeGreaterThan(0);
  });
});
