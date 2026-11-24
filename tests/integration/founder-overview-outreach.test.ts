import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

// B9b: the founder overview must say what is true about outreach. ADR-090 added a real email lane in test mode; it is
// off and stays off until the owner says "live". The old line said automated outreach was simply off.
const words = readFileSync('apps/web/components/founder-overview.tsx', 'utf8').replace(/\s+/g, ' ');

test('the founder overview says real outreach exists in test mode and is off until the owner says live', () => {
  expect(words).not.toMatch(/Automated outreach/);
  expect(words).toContain(
    'Real outreach by email exists in test mode only and stays off until the owner says &quot;live&quot;.',
  );
  expect(words).toContain('Live AI and contributor payments stay off.');
  expect(words).toMatch(/All three are\{' '\} <StatusBadge tone="caution">GATED<\/StatusBadge>/);
});

test('the founder overview keeps plain words and no long dash', () => {
  expect(words).not.toMatch(/\u2014|\u2013/);
  expect(words).not.toMatch(/synthetic outreach|outreach is live/i);
});
