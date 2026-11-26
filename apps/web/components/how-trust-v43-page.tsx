'use client';

import dynamic from 'next/dynamic';

// /how-it-works and /trust with CORRIDRA_UX_HOW_TRUST_V43 on (owner, 26 Nov 2026, first hand to Guardian G66: "yes to
// all three, build it"): the two pages render these only while the switch (and the home page v4.3) is on. Same lazy
// boundary as the home v4.3 one: each composition and its stylesheet are a chunk loaded from here, so with the switch
// off the two pages ship neither. They stay plain functions so a fixture can render them outside Next.js.
const HowItWorksV43 = dynamic(() => import('./how-it-works-v43').then((m) => m.HowItWorksV43));
const TrustV43 = dynamic(() => import('./trust-v43').then((m) => m.TrustV43));

export function HowItWorksV43Page() {
  return <HowItWorksV43 />;
}

export function TrustV43Page() {
  return <TrustV43 />;
}
