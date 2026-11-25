'use client';

import dynamic from 'next/dynamic';

// Home page v4.2 (owner, 25 Nov 2026: "lock this v4.2", "Add a switch, off by default"): app/page.tsx renders this
// only while CORRIDRA_UX_HOME_V42 is exactly "true". The v4.2 composition and its stylesheet are a lazy chunk loaded
// from here (a dynamic import from the server page would not be split), so with the switch off the home page ships
// neither: its HTML and its styles are what they were. The page itself stays a plain function, so every fixture that
// renders the home outside Next.js keeps working.
const HomeV42 = dynamic(() => import('./home-v42').then((m) => m.HomeV42));

export function HomeV42Page({ whatsapp }: { whatsapp: string | null }) {
  return <HomeV42 whatsapp={whatsapp} />;
}
