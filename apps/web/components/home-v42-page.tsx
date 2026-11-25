import { type ReactElement } from 'react';

// Home page v4.2 (owner, 25 Nov 2026: "lock this v4.2", "Add a switch, off by default"): the server side of the v4.2
// home. app/page.tsx renders it only while CORRIDRA_UX_HOME_V42 is exactly "true", and the v4.2 composition and its
// styles are loaded here, only then, so with the switch off the home page and its styles are exactly what they were.
// The page itself stays a plain function, so every fixture that renders the home outside Next.js keeps working.
export async function HomeV42Page({
  whatsapp,
}: {
  whatsapp: string | null;
}): Promise<ReactElement> {
  const { HomeV42 } = await import('./home-v42');
  return <HomeV42 whatsapp={whatsapp} />;
}
