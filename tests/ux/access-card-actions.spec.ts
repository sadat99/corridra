import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { customerDoorPage, teamDoorPage } from '../../apps/web/lib/access-doors';

// Access doors: in a row of .access-card boxes the action buttons share one top edge, at the bottom of the
// card, however many lines of text each card holds. The cards are real registry cards (the words on
// /access/customer and /access/team) laid out by the real stylesheets, because the customer page shows its
// "Other ways to join" row only where sign-in and the programme switches are on, and the test server has none.
// The markup mirrors components/access-page.tsx (AccessCard) and the two pages; the layout is all CSS.
const fixturePath = '/__access-card-actions-fixture';
const css = ['app/globals.css', 'components/page-compact.css', 'app/access/access.css']
  .map((file) => readFileSync(resolve('apps/web', file), 'utf8'))
  .join('\n');

const esc = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const card = (title: string, level: 2 | 3, body: string) =>
  `<article class="access-card"><svg viewBox="0 0 24 24" aria-hidden="true"></svg><h${level}>${esc(title)}</h${level}>${body}</article>`;

const customerRow = customerDoorPage.otherWays.cards
  .map((c) =>
    card(
      c.title,
      3,
      `<p>${esc(c.text)}</p><a class="button-secondary" href="${c.action.href}">${esc(c.action.text)}</a>`,
    ),
  )
  .join('');
// The same three cards with the last one's text tripled, so its text is taller than its neighbours' in any
// font: the fixture loads no web font, so the wrapping of the real words alone cannot be relied on.
const stressRow = customerDoorPage.otherWays.cards
  .map((c, index, all) =>
    card(
      c.title,
      3,
      `<p>${esc(index === all.length - 1 ? `${c.text} ${c.text} ${c.text}` : c.text)}</p><a class="button-secondary" href="${c.action.href}">${esc(c.action.text)}</a>`,
    ),
  )
  .join('');
const teamRow = teamDoorPage.cards
  .map((c) =>
    card(
      c.title,
      2,
      `<p>${esc(c.text)}</p><a class="${c.actionKind === 'primary' ? 'button' : 'button-secondary'}" href="${c.action.href}">${esc(c.action.text)}</a><a class="text-link" href="${c.textLink.href}">${esc(c.textLink.text)}</a>`,
    ),
  )
  .join('');

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Access card actions fixture</title><style>${css}</style></head><body><div class="site-shell"><main id="app" class="ux-public"><div class="access-page"><div id="customer" class="access-cards access-cards--three">${customerRow}</div><div id="stress" class="access-cards access-cards--three">${stressRow}</div><div id="team" class="access-cards">${teamRow}</div></div></main></div></body></html>`;

for (const width of [1024, 1440]) {
  for (const row of ['customer', 'stress']) {
    test(`the three ${row} card buttons share one top edge at ${width}px`, async ({ page }) => {
      await page.route('**' + fixturePath + '*', (route) =>
        route.fulfill({ contentType: 'text/html', body: html }),
      );
      await page.setViewportSize({ width, height: 900 });
      await page.goto(fixturePath);
      const cards = page.locator(`#${row} .access-card`);
      await expect(cards).toHaveCount(3);
      const boxes = await cards.evaluateAll((nodes) =>
        nodes.map((node) => {
          const card = node.getBoundingClientRect();
          const action = node.querySelector('a')!.getBoundingClientRect();
          return {
            cardTop: card.top,
            cardBottom: card.bottom,
            top: action.top,
            bottom: action.bottom,
          };
        }),
      );
      // One row: the cards start at the same height and, stretched by the grid, end at the same height.
      expect(new Set(boxes.map((b) => Math.round(b.cardTop))).size, 'one row').toBe(1);
      expect(new Set(boxes.map((b) => Math.round(b.cardBottom))).size, 'equal heights').toBe(1);
      // The buttons share one top edge, so they share one bottom edge too.
      const tops = boxes.map((b) => b.top);
      expect(Math.max(...tops) - Math.min(...tops), `button tops ${tops.join(', ')}`).toBeLessThan(
        0.5,
      );
      // And they sit at the bottom of the card: the gap under each is the card's padding, not spare space.
      const gaps = boxes.map((b) => b.cardBottom - b.bottom);
      expect(
        Math.max(...gaps) - Math.min(...gaps),
        `gaps under the buttons ${gaps.join(', ')}`,
      ).toBeLessThan(0.5);
    });
  }

  test(`the team card actions end at the bottom of both cards at ${width}px`, async ({ page }) => {
    await page.route('**' + fixturePath + '*', (route) =>
      route.fulfill({ contentType: 'text/html', body: html }),
    );
    await page.setViewportSize({ width, height: 900 });
    await page.goto(fixturePath);
    const cards = page.locator('#team .access-card');
    await expect(cards).toHaveCount(2);
    // The text link is the last action of each card; the button above it ends where the link begins. The
    // primary and secondary buttons are not the same height, so their tops are compared by their bottoms.
    const edges = await cards.evaluateAll((nodes) =>
      nodes.map((node) => {
        const links = [...node.querySelectorAll('a')].map((a) => a.getBoundingClientRect());
        return {
          count: links.length,
          buttonBottom: links[0]!.bottom,
          linkTop: links[1]!.top,
          cardBottom: node.getBoundingClientRect().bottom,
          linkBottom: links[1]!.bottom,
        };
      }),
    );
    expect(edges.map((e) => e.count)).toEqual([2, 2]);
    expect(
      Math.abs(edges[0]!.buttonBottom - edges[1]!.buttonBottom),
      'button bottoms',
    ).toBeLessThan(0.5);
    expect(Math.abs(edges[0]!.linkTop - edges[1]!.linkTop), 'text link tops').toBeLessThan(0.5);
    expect(
      Math.abs(
        edges[0]!.cardBottom - edges[0]!.linkBottom - (edges[1]!.cardBottom - edges[1]!.linkBottom),
      ),
      'gaps under the text links',
    ).toBeLessThan(0.5);
  });
}

test('on a phone the stacked cards keep their natural height', async ({ page }) => {
  await page.route('**' + fixturePath + '*', (route) =>
    route.fulfill({ contentType: 'text/html', body: html }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(fixturePath);
  const gaps = await page.locator('#customer .access-card').evaluateAll((nodes) =>
    nodes.map((node) => {
      const card = node.getBoundingClientRect();
      const action = node.querySelector('a')!.getBoundingClientRect();
      const padding = parseFloat(getComputedStyle(node).paddingBottom);
      return Math.round(card.bottom - action.bottom - padding - 1);
    }),
  );
  // No spare space under the button: the card ends one padding and one border below it.
  expect(gaps).toEqual([0, 0, 0]);
});
