'use client';

import { HomeV43 } from './home-v43';
import { HomeV44Choice } from './home-v44-choice';
import { HomeV44Closing } from './home-v44-closing';
import { HomeV44Footer } from './home-v44-footer';
import { HomeV44Hero } from './home-v44-hero';
import { HomeV44Example, HomeV44Process, HomeV44Trust } from './home-v44-parts';
import { HomeV44Sheet } from './home-v44-sheet';
import { HomeV44Status } from './home-v44-status';
import './home-v44.css';
import './how-trust-v43.css';

// The home page v4.4 with CORRIDRA_UX_HOW_TRUST_V43 also on: the same page with the process and trust bands as
// summaries, as HomeV43Summarised does. A lazy chunk loaded from home-v44-page.tsx only then.
export function HomeV44Summarised({ whatsapp }: { whatsapp: string | null }) {
  return (
    <HomeV43
      whatsapp={whatsapp}
      summaries={{ process: <HomeV44Process />, trust: <HomeV44Trust /> }}
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
