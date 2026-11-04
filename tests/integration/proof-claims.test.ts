import { describe, expect, it } from 'vitest';
import { proofClaimsIn } from './proof-claims';

// Red fixtures for the honest-proof guard: each of these is a claim and must be found; each denial must not be.
const found = (...blocks: string[]) => proofClaimsIn(blocks).length > 0;

describe('the proof guard finds claims', () => {
  it.each([
    'Trusted by 40 exporters.',
    'Trusted by 100 companies with no subscription fees.',
    'Join 1,200 companies today.',
    'Read our testimonials.',
    'We guarantee meetings with buyers.',
    'Verified suppliers only.',
    'The leading platform for trade.',
    'We never charge setup fees, but we are trusted by 300 companies.',
    'No hidden costs. Trusted by 12 suppliers.',
    'We never fake testimonials, read our testimonials.',
    'We never fake testimonials and read our testimonials.',
    'We do not say trusted by anyone, but Trusted by 100 companies.',
  ])('%s', (text) => expect(found(text)).toBe(true));

  it('finds a claim in the block after a block that holds a denial', () => {
    expect(found('We do not promise sales.', 'Trusted by 100 companies.')).toBe(true);
    expect(found('We do not book travel or guarantee meetings', 'Trusted by 5 buyers')).toBe(true);
  });

  it('does not let a denial at the end of one block cover a claim at the start of the next', () => {
    // Read as one run of text these would be "...guarantee results Trusted by...", with the denial first.
    expect(found('We do not offer', 'Trusted by 100 companies')).toBe(true);
  });
});

describe('the proof guard leaves plain copy and denials alone', () => {
  it.each([
    'We do not book travel or guarantee meetings.',
    'We do not promise sales or claim results from programmes that have not taken place.',
    'There are no guaranteed meetings.',
    'A plan for a trip.',
    'Bring a requirement and we will say what we can take on.',
    'We cannot say that a supplier is verified buyers or testimonials.',
  ])('%s', (text) => expect(found(text)).toBe(false));
});
