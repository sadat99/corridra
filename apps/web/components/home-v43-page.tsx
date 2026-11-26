'use client';

import dynamic from 'next/dynamic';

// Home page v4.3 (owner, 26 Nov 2026, via the Guardian: "update as per attachment 100% correctly"): app/page.tsx
// renders this only while CORRIDRA_UX_HOME_V43 is exactly "true". Same lazy boundary as the v4.2 one: the composition
// and its stylesheet are a chunk loaded from here, so with the switch off the home page ships neither. The page stays
// a plain function so fixtures that render the home outside Next.js keep working.
const HomeV43 = dynamic(() => import('./home-v43').then((m) => m.HomeV43));

export function HomeV43Page({ whatsapp }: { whatsapp: string | null }) {
  return <HomeV43 whatsapp={whatsapp} />;
}
