'use client';

import dynamic from 'next/dynamic';

// The home page (owner, 27 Nov 2026): app/page.tsx renders this; the composition and its stylesheet are a chunk loaded
// from here. The `summaries` argument is kept so the page's caller is unchanged: the approved page is the one page.
const HomeV7 = dynamic(() => import('./home-v7').then((m) => m.HomeV7));

export function HomeV44Page({ whatsapp }: { whatsapp: string | null; summaries?: boolean }) {
  return <HomeV7 whatsapp={whatsapp} />;
}
