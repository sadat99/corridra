'use client';

import { HomeV43 } from './home-v43';
import { HomeV44Choice } from './home-v44-choice';
import { HomeV44Closing } from './home-v44-closing';
import { HomeV44Footer } from './home-v44-footer';
import { HomeV44Hero } from './home-v44-hero';
import { HomeV44Example } from './home-v44-parts';
import { HomeV44Sheet } from './home-v44-sheet';
import { HomeV44Status } from './home-v44-status';
import './home-v44.css';

// The home page v4.4, shown only while CORRIDRA_UX_HOME_V44 and CORRIDRA_UX_HOME_V43 are both exactly "true" (owner,
// 27 Nov 2026, decision 4 "keep mine"; docs/revamp/specs/ui-ux-v4-4.md once the Guardian locks it). It is the v4.3
// page with the redesign hero and the route map in the route choice and in the request form; every other band, word,
// address and payload is v4.3's, so the header, footer and the rest of the page do not change. A lazy chunk loaded from
// home-v44-page.tsx only then, so the home with the switch off ships neither this nor its stylesheet.
export function HomeV44({ whatsapp }: { whatsapp: string | null }) {
  return (
    <HomeV43
      whatsapp={whatsapp}
      v44={{
        hero: <HomeV44Hero />,
        choice: (props) => <HomeV44Choice {...props} />,
        status: <HomeV44Status />,
        footer: <HomeV44Footer />,
        closing: (props) => <HomeV44Closing {...props} />,
        example: (props) => <HomeV44Example {...props} />,
        sheet: (props) => <HomeV44Sheet {...props} />,
      }}
    />
  );
}
